import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer'; 
import crypto from 'crypto'; 

// --- Configuración Inicial ---
dotenv.config(); 
const app = express();
const PORT = process.env.PORT || 5000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
app.use(cors());
app.use(express.json());
// Servir archivos estáticos (imágenes subidas)
const uploadsPath = path.join(__dirname, 'uploads');
console.log('>>> Sirviendo archivos estáticos para /images desde:', uploadsPath);
app.use('/images', express.static(uploadsPath));

// --- Configuración de Email ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ordazruudvan@gmail.com', 
        pass: process.env.EMAIL_PASS || 'qpcs cois sjhp wvrl', 
    },
});

// --- Conexión a MongoDB ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/palapalacasona';
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log(`Conectado a MongoDB en ${MONGODB_URI === process.env.MONGODB_URI ? 'URI de entorno' : 'URI local'}`);
  setupInitialConfig(); 
})
.catch(err => console.error('Error de conexión a MongoDB:', err));

// --- ESQUEMAS Y MODELOS ---

// Usuario
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['admin', 'empleado', 'usuario'], default: 'usuario' },
    telefono: {
        type: String, unique: true, sparse: true,
        validate: {
            validator: (v) => v == null || v === '' || /^\d{10}$/.test(v),
            message: props => `${props.value} no es un teléfono válido (10 dígitos).`
        },
        trim: true,
    },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    try { const salt = await bcrypt.genSalt(10); this.password = await bcrypt.hash(this.password, salt); next(); } catch (error) { next(error); }
});
userSchema.methods.comparePassword = async function(candidatePassword) {
    try { if (!this.password) throw new Error("Contraseña almacenada no definida."); return await bcrypt.compare(candidatePassword, this.password); } catch (error) { console.error("Error al comparar contraseñas:", error); return false; }
};
const User = mongoose.model('User', userSchema);

// Habitación
const habitacionSchema = new mongoose.Schema({
    numero: { type: Number, required: true, unique: true },
    tipo: { type: String, required: true, trim: true },
    precio: { type: Number, required: true, min: 0 },
    imageUrls: [{ type: String, trim: true }],
}, { timestamps: true });
const Habitacion = mongoose.model('Habitacion', habitacionSchema);

// Reserva (Cuarto)
const reservaSchema = new mongoose.Schema({
    habitacion: { type: mongoose.Schema.Types.ObjectId, ref: 'Habitacion', required: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    nombreHuesped: { type: String, trim: true },
    telefonoHuesped: { type: String, trim: true },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, required: true },
    estado: { type: String, enum: ['pendiente', 'confirmada', 'cancelada'], default: 'pendiente' },
    precioTotal: { type: Number, required: true, min: 0 },
    tipoPago: { type: String, enum: ['efectivo', 'transferencia'], required: true },
    emailHuesped: { type: String, trim: true },
}, { timestamps: true });
const Reserva = mongoose.model('Reserva', reservaSchema);

// Evento (Área Social) - ACTUALIZADO
const eventoSchema = new mongoose.Schema({
    nombreCliente: { type: String, required: [true, 'Nombre del cliente obligatorio'], trim: true },
    fechaEvento: { type: Date, required: [true, 'Fecha del evento obligatoria'] },
    horaInicio: { type: String, trim: true },
    horaFin: { type: String, trim: true },
    usoEspecifico: { type: String, trim: true },
    limiteAsistentes: { type: Number, min: 1 },
    areaRentada: { type: String, default: 'Área Social', trim: true },
    monto: { type: Number, required: [true, 'Monto obligatorio'], min: [0, 'Monto no puede ser negativo'] },
    estado: { type: String, enum: ['pendiente', 'confirmado', 'cancelado'], default: 'pendiente' },
}, { timestamps: true });
const Evento = mongoose.model('Evento', eventoSchema);

// Configuración
const configSchema = new mongoose.Schema({
    identificador: { type: String, default: 'configuracion-principal', unique: true },
    cuentaBancaria: { type: String, required: true, trim: true },
    clabe: { type: String, required: true, trim: true },
    banco: { type: String, required: true, trim: true },
    whatsappUrl: { type: String, required: true, trim: true },
});
const Config = mongoose.model('Config', configSchema);

// --- Funciones Auxiliares ---

// Inicializar Configuración
const setupInitialConfig = async () => {
    try {
        const configData = {
          identificador: 'configuracion-principal',
          cuentaBancaria: '4152 31384699 4205',
          clabe: '012 180 01573294185 1',
          banco: 'BBVA',
          whatsappUrl: 'https://wa.me/529514401726?text=Hola,%20aquí%20está%20el%20comprobante%20de%20mi%20reserva.',
        };
        await Config.findOneAndUpdate({ identificador: 'configuracion-principal' }, configData, { upsert: true, new: true, setDefaultsOnInsert: true });
        console.log('Documento de configuración de pago inicializado/verificado.');
      } catch (error) {
        console.error('Error al configurar los datos iniciales:', error.message);
      }
};

// Verificar Conflicto de Reservas
const checkReservationConflict = async (habitacionId, fechaInicio, fechaFin, currentReservaId = null) => {
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    if (inicio >= fin) throw new Error("Fecha de inicio debe ser anterior a fecha de fin.");
    let query = {
        habitacion: habitacionId,
        estado: { $in: ['pendiente', 'confirmada'] },
        fechaInicio: { $lt: fin },
        fechaFin: { $gt: inicio }
    };
    if (currentReservaId) query._id = { $ne: currentReservaId };
    const existing = await Reserva.find(query);
    return existing.length > 0;
};

// Enviar Email de Confirmación
const sendConfirmationEmail = async (reserva, datosCliente, configuracionPago) => {
    try {
        let habitacion = reserva.habitacion;
        if (!habitacion || !habitacion.tipo) {
            console.log("Populando habitación para email...");
            const reservaCompleta = await Reserva.findById(reserva._id).populate('habitacion');
            if (!reservaCompleta || !reservaCompleta.habitacion) {
                console.error(`Error: No se encontró habitación para reserva ${reserva._id} al enviar email.`);
                return;
            }
            habitacion = reservaCompleta.habitacion;
        }

        const mailOptions = {
            from: `"Palapa La Casona" <${process.env.EMAIL_USER || 'ordazruudvan@gmail.com'}>`,
            to: datosCliente.email,
            subject: `✅ Reserva Pendiente - Palapa La Casona (${habitacion.tipo})`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                    <div style="text-align: center; padding-bottom: 10px;">
                        <h1 style="color: #6C7D5C; font-size: 28px;">¡Gracias por tu reserva, ${datosCliente.nombre}!</h1>
                    </div>
                    <p style="font-size: 16px;">Hemos recibido tu solicitud de reserva. Aquí están los detalles:</p>
                    <h3 style="color: #1C2A3D; margin-top: 20px;">Detalles de la Estancia</h3>
                    <ul style="list-style: none; padding-left: 0; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border-left: 5px solid #D4AF37;">
                        <li><strong>Habitación:</strong> ${habitacion.tipo} (No. ${habitacion.numero})</li>
                        <li><strong>Llegada:</strong> ${new Date(reserva.fechaInicio).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                        <li><strong>Salida:</strong> ${new Date(reserva.fechaFin).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                        <li><strong>Huésped:</strong> ${datosCliente.nombre}</li>
                        <li><strong>Teléfono:</strong> ${datosCliente.telefono || 'No proporcionado'}</li>
                        <li><strong>Precio Total:</strong> <strong style="color: #6C7D5C; font-size: 18px;">$${reserva.precioTotal.toFixed(2)} MXN</strong></li>
                    </ul>
                    <h3 style="color: #1C2A3D; margin-top: 20px;">Instrucciones de Pago</h3>
                    ${reserva.tipoPago === 'transferencia' && configuracionPago ? `
                        <p>Tu reserva está **pendiente** de confirmación. Por favor, realiza una transferencia por el monto total a los siguientes datos:</p>
                        <div style="background-color: #fff; border: 1px dashed #D4AF37; padding: 15px; border-radius: 8px; margin-top: 10px;">
                            <p><strong>Banco:</strong> ${configuracionPago.banco}</p>
                            <p><strong>Cuenta Bancaria:</strong> ${configuracionPago.cuentaBancaria}</p>
                            <p><strong>CLABE:</strong> ${configuracionPago.clabe}</p>
                        </div>
                        <p style="margin-top: 15px;">Una vez completado el pago, **es indispensable** que envíes el comprobante a nuestro <a href="${configuracionPago.whatsappUrl}" style="color: #6C7D5C; font-weight: bold; text-decoration: none;">WhatsApp</a> para que tu reserva pase a estado "Confirmada".</p>
                    ` : `
                        <p>El pago de <strong style="color: #6C7D5C;">$${reserva.precioTotal.toFixed(2)} MXN</strong> se realizará en **efectivo** al llegar al hotel durante el check-in.</p>
                        <p style="font-size: 14px; color: #999;">Tu reserva está marcada como "Pendiente" hasta el check-in.</p>
                    `}
                    <p style="margin-top: 30px; text-align: center; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 15px;">
                        Esperamos verte pronto. ¡Buen viaje!
                    </p>
                </div>
            `,
        };
        const info = await transporter.sendMail(mailOptions);
        console.log("Mensaje de confirmación enviado a: %s", datosCliente.email, "ID:", info.messageId);
    } catch (error) {
        console.error("ERROR al enviar el correo:", error);
    }
};

// --- Configuración de Multer (Subida de Imágenes) ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const roomId = req.params.roomId;
        if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
            return cb(new Error('ID de habitación inválido o faltante'), false);
        }
        const roomPath = path.join(__dirname, 'uploads', roomId.toString());
        try {
            await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
            await fs.mkdir(roomPath, { recursive: true });
            cb(null, roomPath);
        } catch (err) { cb(err, false); }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
        const extension = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${extension}`);
    }
});
const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Formato de imagen no soportado.'), false);
    }
};
const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 1024 * 1024 * 5 } });

// --- RUTAS DE LA API ---

// Login
app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: 'Usuario y contraseña requeridos.' });
      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });
      if (typeof user.comparePassword !== 'function') { console.error(`Error: comparePassword no definido para ${user.username}`); throw new Error('Error interno al verificar contraseña.'); }
      const isMatch = await user.comparePassword(password);
      if (!isMatch) return res.status(400).json({ message: 'Contraseña incorrecta.' });
      res.status(200).json({ message: 'Login exitoso.', user: { _id: user._id, username: user.username, role: user.role } });
    } catch (error) { console.error("ERROR EN LOGIN:", error); res.status(500).json({ message: 'Error en servidor durante login.', error: error.message }); }
});

// Reservas (Cuartos)
app.get('/api/reservas', async (req, res) => {
    try {
        const { periodo } = req.query;
        let dateFilter = {};
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        if (periodo === 'semana') {
            const dayOfWeek = hoy.getDay();
            const diff = hoy.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
            const inicioSemana = new Date(hoy.setDate(diff)); inicioSemana.setHours(0, 0, 0, 0);
            const finSemana = new Date(inicioSemana); finSemana.setDate(inicioSemana.getDate() + 6); finSemana.setHours(23, 59, 59, 999);
            dateFilter = { fechaInicio: { $gte: inicioSemana, $lte: finSemana } };
        } else if (periodo === 'mes') {
            const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); finMes.setHours(23, 59, 59, 999);
            dateFilter = { fechaInicio: { $gte: inicioMes, $lte: finMes } };
        } else if (periodo === 'año') {
            const inicioAño = new Date(hoy.getFullYear(), 0, 1);
            const finAño = new Date(hoy.getFullYear(), 11, 31); finAño.setHours(23, 59, 59, 999);
            dateFilter = { fechaInicio: { $gte: inicioAño, $lte: finAño } };
        }

        const reservas = await Reserva.find(dateFilter)
          .populate('habitacion', 'numero tipo precio')
          .populate('usuario', 'username')
          .sort({ fechaInicio: 1 });
        res.json(reservas);
      } catch (error) { console.error("Error al obtener reservas:", error); res.status(500).json({ message: 'Error al obtener reservas.', error: error.message }); }
});

app.post('/api/reservas', async (req, res) => {
    // Extrae 'telefono'
    const { habitacionId, fechaInicio, fechaFin, tipoPago, clientName, clientEmail, telefono, usuarioId } = req.body;
    console.log(">>> Datos recibidos en POST /api/reservas:", req.body);
    // Validaciones
    if (!habitacionId || !fechaInicio || !fechaFin || !tipoPago) return res.status(400).json({ message: 'Faltan datos obligatorios.' });
    if (!usuarioId && (!clientName || !clientEmail || !telefono)) console.warn("Advertencia: Creando reserva pública sin nombre, email o teléfono.");
    if (new Date(fechaInicio) >= new Date(fechaFin)) return res.status(400).json({ message: 'Fecha de salida debe ser posterior.' });
    try {
        const hasConflict = await checkReservationConflict(habitacionId, fechaInicio, fechaFin);
        if (hasConflict) return res.status(409).json({ message: 'Conflicto: Habitación ya reservada.' });
        const habitacion = await Habitacion.findById(habitacionId);
        if (!habitacion) return res.status(404).json({ message: 'Habitación no encontrada.' });
        const inicio = new Date(fechaInicio); const fin = new Date(fechaFin);
        const diffDays = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return res.status(400).json({ message: 'Estancia mínima de 1 día.' });
        const precioTotal = diffDays * habitacion.precio;
        // Guarda telefonoHuesped
        const reservaData = {
            habitacion: habitacionId, fechaInicio: inicio, fechaFin: fin, precioTotal, tipoPago,
            nombreHuesped: clientName || undefined, emailHuesped: clientEmail || undefined, telefonoHuesped: telefono || undefined,
            usuario: usuarioId && mongoose.Types.ObjectId.isValid(usuarioId) ? usuarioId : null,
        };
        console.log(">>> Datos preparados para guardar (reservaData):", reservaData);
        const nuevaReserva = new Reserva(reservaData);
        await nuevaReserva.save();
        console.log(">>> Reserva guardada con éxito:", nuevaReserva);
        // Envía email
        if (clientEmail) {
            const configData = await Config.findOne({ identificador: 'configuracion-principal' });
            const datosCliente = { nombre: clientName || "Estimado Huésped", email: clientEmail, telefono: telefono };
            sendConfirmationEmail({ ...nuevaReserva.toObject(), habitacion }, datosCliente, configData);
        }
        res.status(201).json({ message: 'Reserva creada.', reserva: nuevaReserva, configuracionPago: await Config.findOne({ identificador: 'configuracion-principal' }) });
    } catch (error) {
        console.error("Error al crear reserva:", error);
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', error: error.message });
        res.status(500).json({ message: 'Error interno al crear reserva.', error: error.message });
    }
});

app.put('/api/reservas/:id', async (req, res) => {
    const { id } = req.params;
    const allowedUpdates = ['habitacionId', 'usuarioId', 'nombreHuesped', 'fechaInicio', 'fechaFin', 'estado', 'tipoPago', 'emailHuesped', 'telefonoHuesped'];
    const updates = {}; let needsRecalculation = false;
    for (const key in req.body) {
        if (allowedUpdates.includes(key)) {
             if (key === 'habitacionId') { updates['habitacion'] = req.body[key]; needsRecalculation = true; }
             else if (key === 'usuarioId') { updates['usuario'] = req.body[key] === '' || req.body[key] === null ? null : req.body[key]; }
             else { updates[key] = req.body[key]; } 
             if (key === 'fechaInicio' || key === 'fechaFin') { needsRecalculation = true; }
        }
    }
    console.log(`>>> Datos recibidos para ACTUALIZAR Reserva (ID: ${id}):`, req.body); console.log(`>>> Datos que se APLICARÁN (updates):`, updates);
    try {
        const reservaOriginal = await Reserva.findById(id);
        if (!reservaOriginal) return res.status(404).json({ message: 'Reserva no encontrada.' });
        const checkInicio = updates.fechaInicio || reservaOriginal.fechaInicio; const checkFin = updates.fechaFin || reservaOriginal.fechaFin;
        if (checkInicio && checkFin && new Date(checkInicio) >= new Date(checkFin)) return res.status(400).json({ message: 'Fechas inválidas.' });
        const checkHabitacion = updates.habitacion || reservaOriginal.habitacion;
        if (needsRecalculation) { const hasConflict = await checkReservationConflict(checkHabitacion, checkInicio, checkFin, id); if (hasConflict) return res.status(409).json({ message: 'Conflicto de fechas.' }); }
        if (needsRecalculation) {
            const habitacion = await Habitacion.findById(checkHabitacion);
            if (!habitacion) return res.status(404).json({ message: 'Habitación para recálculo no encontrada.' });
            const inicio = new Date(checkInicio); const fin = new Date(checkFin);
            const diffDays = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return res.status(400).json({ message: 'La estancia debe ser de al menos un día.' });
            updates.precioTotal = diffDays * habitacion.precio;
        }
        const updatedReserva = await Reserva.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).populate('habitacion', 'numero tipo precio').populate('usuario', 'username');
        if (!updatedReserva) return res.status(404).json({ message: 'Reserva no encontrada post-update.' });
        console.log(`>>> Reserva ACTUALIZADA con éxito:`, updatedReserva);
        res.json({ message: 'Reserva actualizada.', reserva: updatedReserva });
    } catch (error) {
        console.error("❌ Error al actualizar reserva:", error);
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', error: error.message });
        res.status(500).json({ message: 'Error interno al actualizar reserva.', error: error.message });
    }
});

app.delete('/api/reservas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const deletedReserva = await Reserva.findByIdAndDelete(id);
        if (!deletedReserva) return res.status(404).json({ message: 'Reserva no encontrada.' });
        res.json({ message: 'Reserva eliminada.' });
    } catch (error) { console.error("❌ Error al eliminar reserva:", error); res.status(500).json({ message: 'Error interno al eliminar reserva.', error: error.message }); }
});

// Eventos (Área Social)
app.get('/api/eventos', async (req, res) => {
    try {
        const eventos = await Evento.find({}).sort({ fechaEvento: 1 });
        res.json(eventos);
      } catch (error) { console.error("Error al obtener eventos:", error); res.status(500).json({ message: 'Error al obtener eventos.', error: error.message }); }
});

app.post('/api/eventos', async (req, res) => {
    try {
        const { nombreCliente, fechaEvento, horaInicio, horaFin, usoEspecifico, limiteAsistentes, areaRentada, monto, estado } = req.body;
        const eventoData = { nombreCliente, fechaEvento, horaInicio, horaFin, usoEspecifico, limiteAsistentes, areaRentada, monto, estado };
        console.log(">>> Creando nuevo evento con datos:", eventoData);
        const nuevoEvento = new Evento(eventoData);
        await nuevoEvento.save();
        console.log(">>> Evento guardado:", nuevoEvento);
        res.status(201).json(nuevoEvento);
      } catch (error) {
        console.error("Error al crear evento:", error);
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', errors: error.errors });
        res.status(500).json({ message: 'Error interno al crear evento.', error: error.message });
      }
});

app.put('/api/eventos/:id', async (req, res) => {
    const { id } = req.params;
    const allowedUpdates = ['nombreCliente', 'fechaEvento', 'areaRentada', 'monto', 'estado', 'horaInicio', 'horaFin', 'usoEspecifico', 'limiteAsistentes'];
    const updates = {};
    for (const key in req.body) { if (allowedUpdates.includes(key)) { updates[key] = req.body[key]; } }
    console.log(`>>> Actualizando evento ${id} con datos:`, updates);
    try {
        const evento = await Evento.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
        if (!evento) return res.status(404).json({ message: 'Evento no encontrado.' });
        console.log(`>>> Evento ${id} actualizado.`, evento);
        res.json(evento);
    } catch (error) {
        console.error("Error al actualizar evento:", error);
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', errors: error.errors });
        res.status(500).json({ message: 'Error interno al actualizar evento.', error: error.message });
    }
});

app.delete('/api/eventos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const evento = await Evento.findByIdAndDelete(id);
        if (!evento) return res.status(404).json({ message: 'Evento no encontrado.' });
        res.json({ message: 'Evento eliminado.' });
      } catch (error) { console.error("Error al eliminar evento:", error); res.status(500).json({ message: 'Error interno al eliminar evento.', error: error.message }); }
});

// Usuarios
app.get('/api/users-list', async (req, res) => {
    try { const users = await User.find({}, '_id username role'); res.json(users); }
    catch (error) { console.error("Error al obtener lista de usuarios:", error); res.status(500).json({ message: 'Error al obtener usuarios.', error: error.message }); }
});

// Habitaciones (CRUD + Imágenes)
app.post('/api/upload/room-images/:roomId', upload.array('images', 10), async (req, res) => {
    const { roomId } = req.params;
    console.log(`[Upload] Recibida petición POST para habitación: ${roomId}`);
    if (!mongoose.Types.ObjectId.isValid(roomId)) return res.status(400).json({ message: 'ID de habitación inválido.' });
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No se subieron archivos.' });
        console.log(`[Upload] Archivos recibidos para ${roomId}:`, req.files.map(f => f.filename));
        const uploadedImageUrls = req.files.map(file => `/images/${roomId}/${file.filename}`);
        console.log(`[Upload] URLs generadas para ${roomId}:`, uploadedImageUrls);
        const updatedRoom = await Habitacion.findByIdAndUpdate(roomId, { $push: { imageUrls: { $each: uploadedImageUrls } } }, { new: true, runValidators: true });
        if (!updatedRoom) {
            console.error(`[Upload] Error: Habitación ${roomId} no encontrada post-update.`);
            // Intenta borrar archivos huérfanos
            try { for (const file of req.files) { const p = path.join(uploadsPath, roomId.toString(), file.filename); await fs.unlink(p); console.log(`[Upload] Huérfano borrado: ${p}`); } } catch (e) { console.error(`[Upload] Error borrando huérfanos:`, e); }
            return res.status(404).json({ message: 'Habitación no encontrada.' });
        }
        console.log(`[Upload] Éxito: URLs añadidas a ${roomId}.`, updatedRoom.imageUrls);
        res.status(200).json({ message: `${req.files.length} imágenes subidas.`, imageUrls: updatedRoom.imageUrls });
    } catch (error) {
        console.error(`[Upload] Error general subida ${roomId}:`, error);
        if (error instanceof multer.MulterError) return res.status(400).json({ message: `Error Multer: ${error.message}` });
        if (error.message.includes('Formato') || error.message.includes('ID inválido')) return res.status(400).json({ message: error.message });
        res.status(500).json({ message: 'Error interno al subir imágenes.', error: error.message });
    }
});

app.delete('/api/images/:roomId/:filename', async (req, res) => {
    const { roomId, filename } = req.params;
    console.log(`Recibida petición DELETE a /api/images/${roomId}/${filename}`);
    try {
        if (!mongoose.Types.ObjectId.isValid(roomId)) return res.status(400).send('ID de habitación inválido.');
        const decodedFilename = decodeURIComponent(filename);
        const imageUrlToRemove = `/images/${roomId}/${decodedFilename}`;
        console.log(`Intentando quitar URL: ${imageUrlToRemove} de ${roomId}`);
        const updatedRoom = await Habitacion.findByIdAndUpdate(roomId, { $pull: { imageUrls: imageUrlToRemove } }, { new: true });
        if (!updatedRoom) return res.status(404).json({ message: 'Habitación no encontrada o imagen ya no asociada.' });
        const filePath = path.join(uploadsPath, roomId.toString(), decodedFilename);
        try { await fs.access(filePath); await fs.unlink(filePath); console.log(`Archivo físico borrado: ${filePath}`); }
        catch (unlinkError) { if (unlinkError.code === 'ENOENT') console.warn(`Advertencia: Archivo ${filePath} no existía.`); else console.error(`Error al borrar ${filePath}:`, unlinkError); }
        console.log(`Imagen ${decodedFilename} eliminada de ${roomId}. Restantes:`, updatedRoom.imageUrls);
        res.status(200).json({ message: 'Imagen eliminada.', imageUrls: updatedRoom.imageUrls });
    } catch (error) { console.error(`Error general al eliminar imagen ${filename} de ${roomId}:`, error); res.status(500).json({ message: 'Error interno al eliminar imagen.', error: error.message }); }
});

app.get('/api/habitaciones/disponibles', async (req, res) => {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) return res.status(400).json({ message: 'Fechas inicio/fin requeridas.' });
    try {
        const inicio = new Date(fechaInicio); const fin = new Date(fechaFin);
        if (inicio >= fin) return res.status(400).json({ message: 'Fecha salida debe ser posterior.' });
        const conflictos = await Reserva.find({ estado: { $in: ['pendiente', 'confirmada'] }, fechaInicio: { $lt: fin }, fechaFin: { $gt: inicio } }).select('habitacion');
        const idsConflictivas = conflictos.map(c => c.habitacion.toString());
        const disponibles = await Habitacion.find({ _id: { $nin: idsConflictivas } }).sort({ numero: 1 });
        res.json(disponibles);
    } catch (error) { console.error("Error al buscar disponibilidad:", error); res.status(500).json({ message: 'Error al buscar disponibilidad.', error: error.message }); }
});

app.get('/api/habitaciones', async (req, res) => {
    try { const habitaciones = await Habitacion.find({}).sort({ numero: 1 }); res.json(habitaciones); }
    catch (error) { console.error("Error al obtener habitaciones:", error); res.status(500).json({ message: 'Error al obtener habitaciones.', error: error.message }); }
});

app.post('/api/habitaciones', async (req, res) => {
    const { numero, tipo, precio } = req.body;
    if (numero === undefined || !tipo || precio === undefined) return res.status(400).json({ message: 'Número, tipo y precio obligatorios.' });
    if (typeof precio !== 'number' || precio < 0) return res.status(400).json({ message: 'Precio debe ser número positivo.' });
    try {
        const nuevaHabitacion = new Habitacion({ numero, tipo, precio, imageUrls: [] });
        await nuevaHabitacion.save();
        res.status(201).json({ message: 'Habitación creada. Sube imágenes ahora.', habitacion: nuevaHabitacion });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: `Número de habitación ${numero} ya existe.` });
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', errors: error.errors });
        console.error("Error al crear habitación:", error); res.status(500).json({ message: 'Error al crear habitación.', error: error.message });
    }
});

app.put('/api/habitaciones/:id', async (req, res) => {
    const { id } = req.params;
    const { numero, tipo, precio } = req.body;
    if (numero === undefined && !tipo && precio === undefined) return res.status(400).json({ message: 'Se requiere número, tipo o precio para actualizar.' });
    if (precio !== undefined && (typeof precio !== 'number' || precio < 0)) return res.status(400).json({ message: 'Precio debe ser número positivo.' });
    const updateData = {}; if (numero !== undefined) updateData.numero = numero; if (tipo) updateData.tipo = tipo; if (precio !== undefined) updateData.precio = precio;
    try {
        const updatedHabitacion = await Habitacion.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
        if (!updatedHabitacion) return res.status(404).json({ message: 'Habitación no encontrada.' });
        res.json({ message: 'Habitación actualizada.', habitacion: updatedHabitacion });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: `Número de habitación ${numero} ya existe.` });
        if (error.name === 'ValidationError') return res.status(400).json({ message: 'Datos inválidos.', errors: error.errors });
        console.error("❌ Error al actualizar habitación:", error); res.status(500).json({ message: 'Error al actualizar habitación.', error: error.message });
    }
});

app.delete('/api/habitaciones/:id', async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('ID de habitación inválido.');
    try {
        const deletedHabitacion = await Habitacion.findByIdAndDelete(id);
        if (!deletedHabitacion) return res.status(404).json({ message: 'Habitación no encontrada.' });
        const roomPath = path.join(uploadsPath, id.toString());
        try { console.log(`Intentando borrar carpeta: ${roomPath}`); await fs.rm(roomPath, { recursive: true, force: true }); console.log(`Carpeta borrada: ${roomPath}`); }
        catch (rmError) { if (rmError.code === 'ENOENT') console.warn(`Carpeta ${roomPath} no existía.`); else console.error(`Error al borrar ${roomPath}:`, rmError); }
        res.json({ message: 'Habitación e imágenes eliminadas.' });
    } catch (error) { console.error(`❌ Error al eliminar habitación ${id}:`, error); res.status(500).json({ message: 'Error interno al eliminar habitación.', error: error.message }); }
});

// Estadísticas
app.get('/api/stats/reservas', async (req, res) => {
    try {
        const statsReservas = await Reserva.aggregate([ { $group: { _id: '$estado', count: { $sum: 1 }, totalIncome: { $sum: { $cond: [{ $eq: ['$estado', 'confirmada'] }, '$precioTotal', 0] } } } }, { $project: { _id: 0, estado: '$_id', count: 1, totalIncome: 1 }} ]);
        const statsEventos = await Evento.aggregate([ { $group: { _id: '$estado', count: { $sum: 1 }, totalIncome: { $sum: { $cond: [{ $eq: ['$estado', 'confirmado'] }, '$monto', 0] } } }}, { $project: { _id: 0, estado: '$_id', count: 1, totalIncome: 1 }} ]);
        const formattedStats = { totalReservas: 0, totalIngresosReservas: 0, reservasPorEstado: { confirmada: 0, pendiente: 0, cancelada: 0 }, totalEventos: 0, totalIngresosEventos: 0, eventosPorEstado: { confirmado: 0, pendiente: 0, cancelado: 0 }, totalHabitaciones: 0 };
        statsReservas.forEach(stat => { formattedStats.totalReservas += stat.count; if (formattedStats.reservasPorEstado[stat.estado] !== undefined) formattedStats.reservasPorEstado[stat.estado] = stat.count; formattedStats.totalIngresosReservas += stat.totalIncome; });
        statsEventos.forEach(stat => { formattedStats.totalEventos += stat.count; if (formattedStats.eventosPorEstado[stat.estado] !== undefined) formattedStats.eventosPorEstado[stat.estado] = stat.count; formattedStats.totalIngresosEventos += stat.totalIncome; });
        formattedStats.totalHabitaciones = await Habitacion.countDocuments();
        res.json(formattedStats);
    } catch (error) { console.error("Error al obtener estadísticas:", error); res.status(500).json({ message: 'Error al obtener estadísticas.', error: error.message }); }
});

// Configuración
app.get('/api/config/contacto', async (req, res) => {
    try {
        const config = await Config.findOne({ identificador: 'configuracion-principal' });
        if (!config) return res.status(404).json({ message: 'Configuración no encontrada.' });
        res.json({ whatsappUrl: config.whatsappUrl });
    } catch (error) { console.error("Error al obtener config contacto:", error); res.status(500).json({ message: 'Error al obtener config.', error: error.message }); }
});

// Galerías Públicas
app.get('/api/gallery/pool', async (req, res) => {
    const poolPath = path.join(uploadsPath, 'pool');
    try { await fs.access(poolPath); const files = await fs.readdir(poolPath); const imageFiles = files.filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f)); const urls = imageFiles.map(f => `/images/pool/${f}`); res.json(urls); }
    catch (error) { if (error.code === 'ENOENT') { console.warn(`Carpeta ${poolPath} no existe.`); res.json([]); } else { console.error("❌ Error al leer galería pool:", error); res.status(500).json({ message: 'Error al obtener galería.', error: error.message }); } }
});
app.get('/api/gallery/food', async (req, res) => {
    const foodPath = path.join(uploadsPath, 'food');
    try { await fs.access(foodPath); const files = await fs.readdir(foodPath); const imageFiles = files.filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f)); const urls = imageFiles.map(f => `/images/food/${f}`); res.json(urls); }
    catch (error) { if (error.code === 'ENOENT') { console.warn(`Carpeta ${foodPath} no existe.`); res.json([]); } else { console.error("❌ Error al leer galería food:", error); res.status(500).json({ message: 'Error al obtener galería.', error: error.message }); } }
});

// --- Generación de Contratos PDF ---

// Función reutilizable para generar PDF
async function generarContratoPDF(res, plantillaNombre, datos, idPrefijo, tipoNombre) {
    let browser = null;
    let tempPdfPath = null;
    const id = datos.id || 'unknown'; 

    try {
        console.log(`[PDF ${tipoNombre} ${id}] Iniciando generación con plantilla: ${plantillaNombre}`);
        const plantillaPath = path.join(__dirname, 'contratos', `${plantillaNombre}.html`);
        const logoPath = path.join(__dirname, 'contratos', 'logo-lacasona.png');
        console.log(`[PDF ${tipoNombre} ${id}] Verificando plantilla y logo...`);
        let html, logoBase64;
        try {
            const [htmlBuffer, logoBuffer] = await Promise.all([fs.readFile(plantillaPath, 'utf-8'), fs.readFile(logoPath)]);
            html = htmlBuffer; logoBase64 = logoBuffer.toString('base64');
            console.log(`[PDF ${tipoNombre} ${id}] Plantilla y logo leídos.`);
        } catch (fsError) { throw new Error(`Error al leer recursos: ${fsError.message}`); }

        const logoDataUri = `data:image/png;base64,${logoBase64}`;
        html = html.replace('src="logo-lacasona.png"', `src="${logoDataUri}"`);
        console.log(`[PDF ${tipoNombre} ${id}] Logo inyectado.`);

        console.log(`[PDF ${tipoNombre} ${id}] Datos preparados:`, datos);
        console.log(`[PDF ${tipoNombre} ${id}] Reemplazando placeholders...`);
        for (const key in datos) { html = html.replace(new RegExp(`{{${key}}}`, 'g'), datos[key] ?? ''); }

        html = html.replace(/<\/p>\s*<\/ol>/i, '</li>\n    </ol>');
        console.log(`[PDF ${tipoNombre} ${id}] Placeholders reemplazados.`);

        console.log(`[PDF ${tipoNombre} ${id}] Lanzando Puppeteer...`);
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        tempPdfPath = path.join(__dirname, `temp_${idPrefijo}_${id}_${Date.now()}.pdf`);
        console.log(`[PDF ${tipoNombre} ${id}] Guardando PDF temporal en: ${tempPdfPath}`);
        await page.pdf({
            path: tempPdfPath, format: 'A4', printBackground: true,
            margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' } // Ajusta márgenes
        });
        console.log(`[PDF ${tipoNombre} ${id}] PDF guardado temporalmente.`);

        const pdfFileBuffer = await fs.readFile(tempPdfPath);
        console.log(`[PDF ${tipoNombre} ${id}] Archivo leído. Tamaño: ${pdfFileBuffer.length} bytes.`);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=${idPrefijo}-${id}.pdf`);
        console.log(`[PDF ${tipoNombre} ${id}] Enviando respuesta PDF...`);
        res.send(pdfFileBuffer);
        console.log(`[PDF ${tipoNombre} ${id}] Respuesta enviada.`);

    } catch (error) {
        console.error(`[PDF ${tipoNombre} ${id}] Error durante la generación:`, error);
        if (!res.headersSent) { res.status(500).send(`Error al generar contrato ${tipoNombre}: ${error.message}.`); }
        else { console.error(`[PDF ${tipoNombre} ${id}] Error ocurrió después de enviar headers.`); }
    } finally {
        if (browser) { console.log(`[PDF ${tipoNombre} ${id}] Cerrando navegador...`); await browser.close(); }
        if (tempPdfPath) {
            try { console.log(`[PDF ${tipoNombre} ${id}] Eliminando archivo temporal ${tempPdfPath}...`); await fs.unlink(tempPdfPath); console.log(`[PDF ${tipoNombre} ${id}] Archivo temporal eliminado.`); }
            catch (unlinkErr) { if (unlinkErr.code !== 'ENOENT') { console.warn(`[PDF ${tipoNombre} ${id}] No se pudo eliminar ${tempPdfPath}:`, unlinkErr.message); } }
        }
    }
}

// Ruta Contrato Reserva (Usa la función reutilizable)
app.get('/api/reservas/:id/contrato', async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('ID de reserva inválido.');
    try {
        const reserva = await Reserva.findById(id).populate('habitacion').populate('usuario');
        if (!reserva) return res.status(404).send('Reserva no encontrada');
        if (!reserva.habitacion) return res.status(500).send('Datos de habitación faltantes.');

        const getCapacidadMaxima = (tipo) => { const l = tipo.toLowerCase(); switch(l){case 'individual':case 'king':case 'rey':case 'king deluxe':return 2; case 'doble':case 'doble superior':return 4; default: return '?';} };
        const datos = {
            id: reserva._id.toString(),
            nombreHuesped: reserva.nombreHuesped || (reserva.usuario ? reserva.usuario.username : 'Huésped Público'),
            telefonoHuesped: reserva.telefonoHuesped || 'No proporcionado',
            nombreHabitacion: `No. ${reserva.habitacion.numero} (${reserva.habitacion.tipo})`,
            fechaInicio: new Date(reserva.fechaInicio).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
            fechaFin: new Date(reserva.fechaFin).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
            precioTotal: reserva.precioTotal ? reserva.precioTotal.toFixed(2) : '0.00',
            tipoPago: reserva.tipoPago || 'No especificado',
            fechaActual: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
            capacidadMaxima: getCapacidadMaxima(reserva.habitacion.tipo),
        };
        await generarContratoPDF(res, 'contrato_tipo1', datos, 'contrato-reserva', 'Reserva');
    } catch (error) {
        console.error(`[PDF Reserva ${id}] Error al preparar datos:`, error);
        if (!res.headersSent) res.status(500).send(`Error al preparar contrato: ${error.message}`);
    }
});

// Ruta Contrato Evento (Usa la función reutilizable)
app.get('/api/eventos/:id/contrato', async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('ID de evento inválido.');
    try {
        const evento = await Evento.findById(id);
        if (!evento) return res.status(404).send('Evento no encontrado.');
        const datos = {
            id: evento._id.toString(),
            cliente: evento.nombreCliente || 'Cliente no especificado',
            fechaEvento: evento.fechaEvento ? new Date(evento.fechaEvento).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Fecha no especificada',
            area: evento.areaRentada || 'Área no especificada',
            monto: evento.monto ? evento.monto.toFixed(2) : '0.00',
            fechaActual: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
            horaInicio: evento.horaInicio || 'No especificada',
            horaFin: evento.horaFin || 'No especificada',
            usoEspecifico: evento.usoEspecifico || 'No especificado',
            limiteAsistentes: evento.limiteAsistentes || 'No especificado',
        };
        await generarContratoPDF(res, 'contrato_area_social', datos, 'contrato-evento', 'Evento');
    } catch (error) {
        console.error(`[PDF Evento ${id}] Error al preparar datos:`, error);
        if (!res.headersSent) res.status(500).send(`Error al preparar contrato: ${error.message}`);
    }
});

// --- Manejadores de Error (al final) ---
app.use((req, res, next) => {
    console.log(`404 - Ruta no encontrada para: ${req.originalUrl}`);
    res.status(404).json({ message: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
    console.error("Error no controlado:", err.stack);
    const errorMessage = process.env.NODE_ENV === 'production' ? 'Ocurrió un error inesperado.' : err.message;
    res.status(err.status || 500).json({ message: 'Error interno del servidor.', error: errorMessage });
});

// --- Iniciar Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    console.log('Sirviendo imágenes estáticas desde:', uploadsPath);
});