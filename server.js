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
import multer from 'multer'; // Para manejar subida de archivos
import crypto from 'crypto'; // Para generar nombres de archivo únicos

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());

// Middleware para servir archivos estáticos (ANTES del 404)
app.use('/images/habitaciones', express.static(path.join(__dirname, 'uploads')));

// *******************************************************************
// 1. CONFIGURACIÓN DE EMAIL
// *******************************************************************
// Considera mover estas credenciales a variables de entorno (.env)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ordazruudvan@gmail.com', // Email desde donde se enviarán
        pass: process.env.EMAIL_PASS || 'qpcs cois sjhp wvrl', // Contraseña de aplicación
    },
});

// Función para enviar el correo de confirmación de reserva de cuarto
const sendConfirmationEmail = async (reserva, datosCliente, configuracionPago) => {
    try {
        // Asegurarse de que la habitación está populada o buscarla si no lo está
        let habitacion = reserva.habitacion;
        if (!habitacion || !habitacion.tipo) { // Si solo es el ID o falta el tipo
             console.log("Populando habitación para email...");
             const reservaCompleta = await Reserva.findById(reserva._id).populate('habitacion');
             if (!reservaCompleta || !reservaCompleta.habitacion) {
                 console.error(`Error: No se encontró la habitación para la reserva ${reserva._id} al enviar email.`);
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
        console.log("✅ Mensaje de confirmación enviado a: %s", datosCliente.email, "ID:", info.messageId);
    } catch (error) {
        console.error("❌ ERROR al enviar el correo. Verifica las credenciales y la conexión:", error);
    }
};

// Conexión a la base de datos MongoDB
// Usa variable de entorno si está definida, si no, usa la local
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/palapalacasona';
mongoose.connect(MONGODB_URI) // useNewUrlParser y useUnifiedTopology ya no son necesarias en Mongoose 6+
.then(() => {
  console.log(`✅ Conectado a MongoDB en ${MONGODB_URI === process.env.MONGODB_URI ? 'URI de entorno' : 'URI local'}`);
  setupInitialConfig();
})
.catch(err => console.error('❌ Error de conexión a MongoDB:', err));


// --- ESQUEMAS Y MODELOS ---

// Esquema de Usuario
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['admin', 'empleado', 'usuario'], default: 'usuario' },
  telefono: {
    type: String,
    unique: true,
    sparse: true, // Permite múltiples documentos con 'telefono' null o ausente
    validate: {
      validator: function(v) {
        // Permite null, vacío o exactamente 10 dígitos
        return v == null || v === '' || /^\d{10}$/.test(v);
      },
      message: props => `${props.value} no es un número de teléfono válido (requiere 10 dígitos).`
    },
    trim: true,
  },
}, { timestamps: true }); // Añade createdAt y updatedAt automáticamente

userSchema.pre('save', async function(next) {
    // Hashear contraseña solo si ha sido modificada (o es nueva)
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10); // Genera salt
        this.password = await bcrypt.hash(this.password, salt); // Hashea con salt
        next();
    } catch (error) {
        next(error); // Pasa el error al siguiente middleware/manejador
    }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        if (!this.password) {
            throw new Error("La contraseña almacenada no está definida.");
        }
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        console.error("Error al comparar contraseñas:", error);
        return false; // Devuelve false en caso de error
    }
};

const User = mongoose.model('User', userSchema);

// Esquema de Habitación
const habitacionSchema = new mongoose.Schema({
  numero: { type: Number, required: true, unique: true },
  tipo: { type: String, required: true, trim: true },
  precio: { type: Number, required: true, min: 0 },
  // ===== INICIO CAMBIO =====
  imageUrls: [{ type: String, trim: true }], // Ahora es un array de Strings
  // ===== FIN CAMBIO =====
}, { timestamps: true });
const Habitacion = mongoose.model('Habitacion', habitacionSchema);

// Esquema de Reserva de Cuarto
const reservaSchema = new mongoose.Schema({
  habitacion: { type: mongoose.Schema.Types.ObjectId, ref: 'Habitacion', required: true },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Asociado a User si es registrado
  nombreHuesped: { type: String, trim: true }, // Nombre si no hay usuario registrado
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  estado: { type: String, enum: ['pendiente', 'confirmada', 'cancelada'], default: 'pendiente' },
  precioTotal: { type: Number, required: true, min: 0 },
  tipoPago: { type: String, enum: ['efectivo', 'transferencia'], required: true },
  emailHuesped: { type: String, trim: true }, // Guardar email para notificaciones
}, { timestamps: true });
const Reserva = mongoose.model('Reserva', reservaSchema);

// Esquema de Evento (Área Social)
const eventoSchema = new mongoose.Schema({
  nombreCliente: { type: String, required: [true, 'El nombre del cliente es obligatorio'], trim: true },
  fechaEvento: { type: Date, required: [true, 'La fecha del evento es obligatoria'] },
  areaRentada: { type: String, default: 'Área Social', trim: true },
  monto: { type: Number, required: [true, 'El monto es obligatorio'], min: [0, 'El monto no puede ser negativo'] },
  estado: { type: String, enum: ['pendiente', 'confirmado', 'cancelado'], default: 'pendiente' },
}, { timestamps: true });
const Evento = mongoose.model('Evento', eventoSchema);

// Esquema de Configuración
const configSchema = new mongoose.Schema({
  identificador: { type: String, default: 'configuracion-principal', unique: true },
  cuentaBancaria: { type: String, required: true, trim: true },
  clabe: { type: String, required: true, trim: true },
  banco: { type: String, required: true, trim: true },
  whatsappUrl: { type: String, required: true, trim: true },
});
const Config = mongoose.model('Config', configSchema);

// Esquema de Categoría de Menú
const categoriaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true, trim: true },
});
const Categoria = mongoose.model('Categoria', categoriaSchema);

// Esquema del Ítem del Menú
const menuItemSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  descripcion: { type: String, trim: true },
  precio: { type: Number, required: true, min: 0 },
  categoria: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true },
}, { timestamps: true });
const MenuItem = mongoose.model('MenuItem', menuItemSchema);


// Función para inicializar la configuración de la base de datos
const setupInitialConfig = async () => {
  try {
    const configData = {
      identificador: 'configuracion-principal', // Clave para encontrar/actualizar
      cuentaBancaria: '4152 31384699 4205',
      clabe: '012 180 01573294185 1',
      banco: 'BBVA',
      whatsappUrl: 'https://wa.me/529514401726?text=Hola,%20aquí%20está%20el%20comprobante%20de%20mi%20reserva.',
    };
    await Config.findOneAndUpdate({ identificador: 'configuracion-principal' }, configData, { upsert: true, new: true, setDefaultsOnInsert: true });
    console.log('✅ Documento de configuración de pago inicializado/verificado.');
  } catch (error) {
    console.error('❌ Error al configurar los datos iniciales:', error.message);
  }
};


// Función de ayuda para Reservas
const checkReservationConflict = async (habitacionId, fechaInicio, fechaFin, currentReservaId = null) => {
  const inicio = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  if (inicio >= fin) {
    throw new Error("La fecha de inicio debe ser anterior a la fecha de fin.");
  }
  let query = {
    habitacion: habitacionId,
    estado: { $in: ['pendiente', 'confirmada'] }, // Solo verifica contra reservas activas
    fechaInicio: { $lt: fin },
    fechaFin: { $gt: inicio }
  };
  if (currentReservaId) {
    query._id = { $ne: currentReservaId };
  }
  const existingReservations = await Reserva.find(query);
  return existingReservations.length > 0;
};

// ===== INICIO: Configuración de Multer para Subida de Imágenes =====
// Define dónde se guardarán las imágenes
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Las imágenes se guardarán en uploads/<roomId>/
    const roomId = req.params.roomId; // Obtenemos el ID de la habitación desde los parámetros de la ruta
    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
        console.error("Multer Destination Error: Room ID inválido o faltante:", roomId);
        return cb(new Error('ID de habitación inválido o faltante en la ruta'), false);
    }
    const roomPath = path.join(__dirname, 'uploads', roomId.toString());
    try {
        // Asegurar que el directorio base 'uploads' existe
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
        // Crear la carpeta específica de la habitación
        await fs.mkdir(roomPath, { recursive: true });
        console.log(`Directorio de destino asegurado: ${roomPath}`);
        cb(null, roomPath); // Llama al callback con la ruta de destino
    } catch (err) {
        console.error("Error al crear directorio para habitación:", err);
        cb(err, false);
    }
  },
  filename: (req, file, cb) => {
    // Genera un nombre de archivo único para evitar colisiones
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const extension = path.extname(file.originalname);
    const newFilename = `${uniqueSuffix}${extension}`;
    console.log(`Generando nombre de archivo: ${newFilename}`);
    cb(null, newFilename);
  }
});

// Filtro para aceptar solo ciertos tipos de imagen
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true); // Aceptar el archivo
  } else {
    console.warn(`Archivo rechazado: Tipo MIME no soportado - ${file.mimetype}`);
    cb(new Error('Formato de imagen no soportado. Solo JPG, PNG, WEBP, GIF.'), false); // Rechazar el archivo
  }
};

// Crear la instancia de multer con la configuración
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 1024 * 1024 * 5 } // Límite de 5MB
});
// ===== FIN: Configuración de Multer =====

// --- RUTAS DE LA API ---

// Ruta de Login
app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
          return res.status(400).json({ message: 'Usuario y contraseña son requeridos.' });
      }
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado.' });
      }
      // Verificar si el método comparePassword existe antes de llamarlo
      if (typeof user.comparePassword !== 'function') {
         console.error(`Error: El método comparePassword no está definido en el modelo User para ${user.username}`);
         throw new Error('Error interno del servidor al verificar contraseña.'); // Lanzar error para catch
      }
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Contraseña incorrecta.' });
      }
      // Devolver solo la info necesaria del usuario
      res.status(200).json({
        message: 'Inicio de sesión exitoso.',
        user: { _id: user._id, username: user.username, role: user.role },
      });
    } catch (error) {
      console.error("❌ ERROR EN LOGIN:", error);
      res.status(500).json({ message: 'Error en el servidor durante el login.', error: error.message });
    }
});

// Rutas de Reservas de Cuartos
app.get('/api/reservas', async (req, res) => {
  try {
    const { periodo } = req.query;
    let dateFilter = {};
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); // Inicio del día

    if (periodo === 'semana') {
      const dayOfWeek = hoy.getDay(); // 0 (Domingo) a 6 (Sábado)
      // Ajuste para que la semana empiece en Lunes (1) y termine en Domingo (0)
      const diff = hoy.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const inicioSemana = new Date(hoy.setDate(diff));
      inicioSemana.setHours(0, 0, 0, 0);

      const finSemana = new Date(inicioSemana);
      finSemana.setDate(inicioSemana.getDate() + 6);
      finSemana.setHours(23, 59, 59, 999); // Fin del Domingo

      // Filtramos por reservas cuya fecha de INICIO caiga en esta semana
      dateFilter = { fechaInicio: { $gte: inicioSemana, $lte: finSemana } };
    } else if (periodo === 'mes') {
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); // Último día del mes actual
      finMes.setHours(23, 59, 59, 999);
      dateFilter = { fechaInicio: { $gte: inicioMes, $lte: finMes } };
    } else if (periodo === 'año') {
      const inicioAño = new Date(hoy.getFullYear(), 0, 1);
      const finAño = new Date(hoy.getFullYear(), 11, 31);
      finAño.setHours(23, 59, 59, 999);
      dateFilter = { fechaInicio: { $gte: inicioAño, $lte: finAño } };
    }
    // Si periodo es 'todas' o inválido, dateFilter queda vacío {}

    const reservas = await Reserva.find(dateFilter)
      .populate('habitacion', 'numero tipo precio') // Incluir info útil de habitación
      .populate('usuario', 'username') // Incluir username si existe
      .sort({ fechaInicio: 1 }); // Ordenar por fecha de inicio ascendente

    res.json(reservas);
  } catch (error) {
    console.error("❌ Error al obtener reservas:", error);
    res.status(500).json({ message: 'Error al obtener las reservas.', error: error.message });
  }
});

app.post('/api/reservas', async (req, res) => {
  const { habitacionId, fechaInicio, fechaFin, tipoPago, clientName, clientEmail, usuarioId } = req.body;

  // Validaciones robustas
  if (!habitacionId || !fechaInicio || !fechaFin || !tipoPago) {
    return res.status(400).json({ message: 'Faltan datos obligatorios (habitación, fechas, tipo de pago).' });
  }
  // Para reservas públicas, el nombre y email son cruciales para el contrato/email
  if (!usuarioId && (!clientName || !clientEmail)) {
     console.warn("Advertencia: Creando reserva pública sin nombre o email de cliente.");
     // Considera si esto debería ser un error 400
     // return res.status(400).json({ message: 'Nombre y email son requeridos para huéspedes públicos.' });
  }
  if (new Date(fechaInicio) >= new Date(fechaFin)) {
    return res.status(400).json({ message: 'La fecha de salida debe ser estrictamente posterior a la de llegada.' });
  }

  try {
    // Verificar conflictos antes de continuar
    const hasConflict = await checkReservationConflict(habitacionId, fechaInicio, fechaFin);
    if (hasConflict) {
      return res.status(409).json({ message: 'Conflicto: La habitación ya está reservada para las fechas seleccionadas.' });
    }

    // Obtener habitación y calcular precio
    const habitacion = await Habitacion.findById(habitacionId);
    if (!habitacion) {
      return res.status(404).json({ message: 'Habitación no encontrada.' });
    }
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const diferenciaMs = fin.getTime() - inicio.getTime();
    const diferenciaDias = Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24));
    if (diferenciaDias <= 0) {
        return res.status(400).json({ message: 'La estancia debe ser de al menos un día.' });
    }
    const precioTotal = diferenciaDias * habitacion.precio;

    // Crear el objeto de la nueva reserva
    const reservaData = {
      habitacion: habitacionId,
      fechaInicio: inicio,
      fechaFin: fin,
      precioTotal,
      tipoPago,
      nombreHuesped: clientName || undefined, // Guardar solo si se proporciona
      emailHuesped: clientEmail || undefined, // Guardar email para notificaciones
      // Asignar usuario si se proporcionó y es válido, sino se queda null por defecto
      usuario: usuarioId && mongoose.Types.ObjectId.isValid(usuarioId) ? usuarioId : null,
    };

    const nuevaReserva = new Reserva(reservaData);
    await nuevaReserva.save();

    // Obtener datos para el correo y enviarlo (asegurándose que clientEmail exista)
    if (clientEmail) {
        const configData = await Config.findOne({ identificador: 'configuracion-principal' });
        const datosClienteParaEmail = { nombre: clientName || "Estimado Huésped", email: clientEmail };
        // Pasamos la habitación encontrada para evitar otra consulta en sendConfirmationEmail
        sendConfirmationEmail({ ...nuevaReserva.toObject(), habitacion }, datosClienteParaEmail, configData);
    } else {
        console.warn(`Advertencia: No se envió correo para reserva ${nuevaReserva._id} por falta de email.`);
    }

    // Devolvemos la reserva creada y los datos de pago
    res.status(201).json({
        message: 'Reserva creada con éxito.',
        reserva: nuevaReserva,
        // Puede que configData no se haya cargado si falló findOne, asegurar que no sea null
        configuracionPago: await Config.findOne({ identificador: 'configuracion-principal' })
    });

  } catch (error) {
    console.error("❌ Error al crear la reserva:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos para la reserva.', error: error.message });
    }
    res.status(500).json({ message: 'Error interno del servidor al crear la reserva.', error: error.message });
  }
});

app.put('/api/reservas/:id', async (req, res) => {
  const { id } = req.params;
  // Solo permitir actualizar campos específicos y seguros
  const allowedUpdates = ['habitacionId', 'usuarioId', 'nombreHuesped', 'fechaInicio', 'fechaFin', 'estado', 'tipoPago', 'emailHuesped'];
  const updates = {};
  let needsRecalculation = false;

  for (const key in req.body) {
    if (allowedUpdates.includes(key)) {
      // Renombrar habitacionId a 'habitacion' y usuarioId a 'usuario' para el modelo
      if (key === 'habitacionId') {
          updates['habitacion'] = req.body[key];
          needsRecalculation = true;
      } else if (key === 'usuarioId') {
          // Si llega vacío o null, se establece como null, si no, se usa el ID
          updates['usuario'] = req.body[key] === '' || req.body[key] === null ? null : req.body[key];
      } else {
          updates[key] = req.body[key];
      }
      // Marcar para recalcular si cambian fechas
      if (key === 'fechaInicio' || key === 'fechaFin') {
          needsRecalculation = true;
      }
    }
  }

  try {
    const reservaOriginal = await Reserva.findById(id);
    if (!reservaOriginal) {
        return res.status(404).json({ message: 'Reserva original no encontrada para actualizar.' });
    }

    // Validar fechas si ambas están presentes en la actualización o combinadas con la original
    const checkInicio = updates.fechaInicio || reservaOriginal.fechaInicio;
    const checkFin = updates.fechaFin || reservaOriginal.fechaFin;
    if (checkInicio && checkFin && new Date(checkInicio) >= new Date(checkFin)) {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior o igual a la fecha de fin.' });
    }

    // Verificar conflictos si se cambian habitación o fechas
    const checkHabitacion = updates.habitacion || reservaOriginal.habitacion;
    if (needsRecalculation) {
        const hasConflict = await checkReservationConflict(checkHabitacion, checkInicio, checkFin, id);
        if (hasConflict) {
            return res.status(409).json({ message: 'Conflicto: La habitación ya está reservada para las nuevas fechas seleccionadas.' });
        }
    }

    // Recalcular precio si es necesario
    if (needsRecalculation) {
        const habitacion = await Habitacion.findById(checkHabitacion);
        if (!habitacion) return res.status(404).json({ message: 'Habitación para recálculo no encontrada.' });
        const inicio = new Date(checkInicio);
        const fin = new Date(checkFin);
        const diferenciaMs = fin.getTime() - inicio.getTime();
        const diferenciaDias = Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24));
        if (diferenciaDias <= 0) return res.status(400).json({ message: 'La estancia debe ser de al menos un día.' });
        updates.precioTotal = diferenciaDias * habitacion.precio;
    }

    // Aplicar la actualización
    const updatedReserva = await Reserva.findByIdAndUpdate(id, updates, { new: true, runValidators: true })
        .populate('habitacion', 'numero tipo precio')
        .populate('usuario', 'username');

    if (!updatedReserva) {
      // Esto no debería pasar si findById funcionó, pero por si acaso
      return res.status(404).json({ message: 'Reserva no encontrada después de actualizar.' });
    }
    res.json({ message: 'Reserva actualizada con éxito.', reserva: updatedReserva });
  } catch (error) {
    console.error("❌ Error al actualizar reserva:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos para actualizar.', error: error.message });
    }
    res.status(500).json({ message: 'Error interno al actualizar la reserva.', error: error.message });
  }
});

app.delete('/api/reservas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deletedReserva = await Reserva.findByIdAndDelete(id);
    if (!deletedReserva) {
      return res.status(404).json({ message: 'Reserva no encontrada para eliminar.' });
    }
    res.json({ message: 'Reserva eliminada con éxito.' });
  } catch (error) {
    console.error("❌ Error al eliminar reserva:", error);
    res.status(500).json({ message: 'Error interno al eliminar la reserva.', error: error.message });
  }
});

// Rutas de Eventos (Área Social)
app.get('/api/eventos', async (req, res) => {
  try {
    const eventos = await Evento.find({}).sort({ fechaEvento: 1 }); // Ordenar por fecha
    res.json(eventos);
  } catch (error) {
    console.error("❌ Error al obtener eventos:", error);
    res.status(500).json({ message: 'Error al obtener los eventos.', error: error.message });
  }
});

app.post('/api/eventos', async (req, res) => {
  try {
    // Extraer solo los campos esperados para evitar inyección de datos
    const { nombreCliente, fechaEvento, areaRentada, monto, estado } = req.body;
    const eventoData = { nombreCliente, fechaEvento, areaRentada, monto, estado };
    const nuevoEvento = new Evento(eventoData);
    await nuevoEvento.save(); // Las validaciones del schema se ejecutan aquí
    res.status(201).json(nuevoEvento);
  } catch (error) {
    console.error("❌ Error al crear evento:", error);
    if (error.name === 'ValidationError') {
        // Mongoose devuelve un objeto con detalles de validación
        return res.status(400).json({ message: 'Datos inválidos para el evento.', errors: error.errors });
    }
    res.status(500).json({ message: 'Error interno al crear el evento.', error: error.message });
  }
});

app.put('/api/eventos/:id', async (req, res) => {
    const { id } = req.params;
    // Extraer solo los campos permitidos para actualizar
    const allowedUpdates = ['nombreCliente', 'fechaEvento', 'areaRentada', 'monto', 'estado'];
    const updates = {};
    for (const key in req.body) {
        if (allowedUpdates.includes(key)) {
            updates[key] = req.body[key];
        }
    }
  try {
    const evento = await Evento.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado.' });
    res.json(evento);
  } catch (error) {
    console.error("❌ Error al actualizar evento:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos para actualizar el evento.', errors: error.errors });
    }
    res.status(500).json({ message: 'Error interno al actualizar el evento.', error: error.message });
  }
});

app.delete('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const evento = await Evento.findByIdAndDelete(id);
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado.' });
    res.json({ message: 'Evento eliminado con éxito.' });
  } catch (error) {
    console.error("❌ Error al eliminar evento:", error);
    res.status(500).json({ message: 'Error interno al eliminar el evento.', error: error.message });
  }
});


// Rutas de Usuarios
app.get('/api/users-list', async (req, res) => {
  try {
    // Devolver también el _id, es útil en el frontend
    const users = await User.find({}, '_id username role'); // Incluir role
    res.json(users);
  } catch (error) {
    console.error("❌ Error al obtener lista de usuarios:", error);
    res.status(500).json({ message: 'Error al obtener la lista de usuarios.', error: error.message });
  }
});
// Faltarían rutas para CRUD de usuarios (POST, PUT, DELETE) si se necesita gestionarlos desde el panel

// Rutas de Habitaciones

app.post('/api/upload/room-images/:roomId', upload.array('images', 10), async (req, res) => {
    const { roomId } = req.params;
    console.log(`Recibida petición POST a /api/upload/room-images/${roomId}`);
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
        return res.status(400).json({ message: 'ID de habitación inválido.' });
    }
    try {
        if (!req.files || req.files.length === 0) {
            console.warn(`No se recibieron archivos para la habitación ${roomId}`);
            return res.status(400).json({ message: 'No se subieron archivos.' });
        }
        console.log(`Archivos recibidos para ${roomId}:`, req.files.map(f => f.filename));
        const uploadedImageUrls = req.files.map(file => `/images/habitaciones/${roomId}/${file.filename}`);
        console.log(`URLs generadas para ${roomId}:`, uploadedImageUrls);
        const updatedRoom = await Habitacion.findByIdAndUpdate(
            roomId,
            { $push: { imageUrls: { $each: uploadedImageUrls } } },
            { new: true }
        );
        if (!updatedRoom) {
            console.error(`Habitación ${roomId} no encontrada después de intentar añadir URLs.`);
            try {
                for (const file of req.files) {
                    const orphanPath = path.join(__dirname, 'uploads', roomId.toString(), file.filename);
                    await fs.unlink(orphanPath);
                    console.log(`Archivo huérfano borrado: ${orphanPath}`);
                }
            } catch (unlinkErr) {
                console.error(`Error al borrar archivos huérfanos para habitación ${roomId} no encontrada:`, unlinkErr);
            }
            return res.status(404).json({ message: 'Habitación no encontrada para añadir imágenes.' });
        }
        console.log(`Imágenes añadidas a la habitación ${roomId}. URLs actualizadas:`, updatedRoom.imageUrls);
        res.status(200).json({
            message: `${req.files.length} imágenes subidas y añadidas con éxito.`,
            imageUrls: updatedRoom.imageUrls
        });
    } catch (error) {
        console.error(`❌ Error general al procesar subida para habitación ${roomId}:`, error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ message: `Error de Multer: ${error.message}` });
        } else if (error.message.includes('Formato de imagen no soportado')) {
             return res.status(400).json({ message: error.message });
        } else if (error.message.includes('ID de habitación inválido')) {
             return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Error interno del servidor al subir las imágenes.', error: error.message });
    }
});

app.delete('/api/images/habitaciones/:roomId/:filename', async (req, res) => {
    const { roomId, filename } = req.params;
    console.log(`Recibida petición DELETE a /api/images/habitaciones/${roomId}/${filename}`);
    try {
        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).send('ID de habitación inválido.');
        }
        // Decodificar el nombre del archivo si contiene caracteres especiales codificados en la URL
        const decodedFilename = decodeURIComponent(filename);
        const imageUrlToRemove = `/images/habitaciones/${roomId}/${decodedFilename}`;

        console.log(`Intentando quitar URL: ${imageUrlToRemove} de la habitación ${roomId}`);
        const updatedRoom = await Habitacion.findByIdAndUpdate(
            roomId,
            { $pull: { imageUrls: imageUrlToRemove } }, // $pull quita elementos del array que coincidan
            { new: true }
        );

        if (!updatedRoom) {
            console.error(`Habitación ${roomId} no encontrada al intentar borrar imagen.`);
            // Si la habitación no existe, no hay nada que borrar.
            // Podríamos verificar si la URL existía antes, pero $pull no da error si no encuentra.
            return res.status(404).json({ message: 'Habitación no encontrada o la imagen ya no estaba asociada.' });
        }

        // Borrar el archivo físico del servidor
        const filePath = path.join(__dirname, 'uploads', roomId.toString(), decodedFilename);
        try {
            await fs.access(filePath); // Verifica si el archivo existe antes de borrar
            await fs.unlink(filePath); // Borra el archivo
            console.log(`Archivo físico borrado: ${filePath}`);
        } catch (unlinkError) {
            if (unlinkError.code === 'ENOENT') { // Error NO ENTry (el archivo no existe)
                console.warn(`Advertencia: El archivo ${filePath} no existía en el servidor al intentar borrarlo.`);
                // Esto es aceptable si la DB se desincronizó o si se borró manualmente
            } else { // Otro error al borrar (ej. permisos)
                console.error(`Error al borrar el archivo físico ${filePath}:`, unlinkError);
                // Considera si esto debería ser un error 500 o solo una advertencia
                // return res.status(500).json({ message: 'Error al borrar el archivo físico.' });
            }
        }

        console.log(`Imagen ${decodedFilename} eliminada de la habitación ${roomId}. URLs restantes:`, updatedRoom.imageUrls);
        res.status(200).json({
            message: 'Imagen eliminada con éxito.',
            imageUrls: updatedRoom.imageUrls // Devuelve el array actualizado
        });

    } catch (error) {
        console.error(`❌ Error general al eliminar imagen ${filename} de habitación ${roomId}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al eliminar la imagen.', error: error.message });
    }
});

app.get('/api/habitaciones/disponibles', async (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  if (!fechaInicio || !fechaFin) {
    return res.status(400).json({ message: 'Se requieren las fechas de inicio y fin.' });
  }
  try {
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    if (inicio >= fin) {
        return res.status(400).json({ message: 'La fecha de salida debe ser posterior a la de llegada.' });
    }
    // Lógica de búsqueda de conflictos
    const conflictos = await Reserva.find({
      estado: { $in: ['pendiente', 'confirmada'] },
      fechaInicio: { $lt: fin },
      fechaFin: { $gt: inicio }
    }).select('habitacion');

    const habitacionIdsConflictivas = conflictos.map(c => c.habitacion.toString());
    // Asegúrate de que esta consulta también devuelva imageUrls
    const habitacionesDisponibles = await Habitacion.find({
        _id: { $nin: habitacionIdsConflictivas }
    }).sort({ numero: 1 }); // Ordenar por número

    res.json(habitacionesDisponibles);
  } catch (error) {
    console.error("❌ Error al buscar disponibilidad:", error);
    res.status(500).json({ message: 'Error al buscar disponibilidad.', error: error.message });
  }
});

app.get('/api/habitaciones', async (req, res) => {
  try {
    // Esta ruta ahora devolverá el campo imageUrls automáticamente porque está en el schema
    const habitaciones = await Habitacion.find({}).sort({ numero: 1 }); // Ordenar por número
    res.json(habitaciones);
  } catch (error) {
    console.error("❌ Error al obtener habitaciones:", error);
    res.status(500).json({ message: 'Error al obtener las habitaciones.', error: error.message });
  }
});

// ===== INICIO CAMBIO =====
// POST /api/habitaciones (Ahora solo crea la estructura básica)
app.post('/api/habitaciones', async (req, res) => {
  // ===== INICIO CAMBIO =====
  const { numero, tipo, precio } = req.body; // <-- Quitado imageUrls de aquí
  // ===== FIN CAMBIO =====
  if (numero === undefined || !tipo || precio === undefined) {
    return res.status(400).json({ message: 'Número, tipo y precio son obligatorios.' });
  }
  if (typeof precio !== 'number' || precio < 0) {
    return res.status(400).json({ message: 'El precio debe ser un número positivo.' });
  }
  try {
    // ===== INICIO CAMBIO =====
    // Crea la habitación con imageUrls vacío
    const nuevaHabitacion = new Habitacion({ numero, tipo, precio, imageUrls: [] });
    // ===== FIN CAMBIO =====
    await nuevaHabitacion.save();
    // Devuelve la habitación creada (el frontend necesitará el _id para subir imágenes después)
    res.status(201).json({ message: 'Habitación creada con éxito. Ahora puedes subir imágenes.', habitacion: nuevaHabitacion });
  } catch (error) { /* ... (manejo de error sin cambios) ... */
    if (error.code === 11000) { /*...*/ }
    console.error("❌ Error al crear habitación:", error);
    if (error.name === 'ValidationError') { /*...*/ }
    res.status(500).json({ message: 'Error al crear la habitación.', error: error.message });
  }
});

// PUT /api/habitaciones/:id (Ahora solo actualiza datos básicos)
app.put('/api/habitaciones/:id', async (req, res) => {
  const { id } = req.params;
  // ===== INICIO CAMBIO =====
  const { numero, tipo, precio } = req.body; // <-- Quitado imageUrls de aquí
  if (numero === undefined && !tipo && precio === undefined) { // <-- Quitado imageUrls de la condición
  // ===== FIN CAMBIO =====
    return res.status(400).json({ message: 'Se requiere al menos un campo (número, tipo o precio) para actualizar.' });
  }
  if (precio !== undefined && (typeof precio !== 'number' || precio < 0)) {
    return res.status(400).json({ message: 'El precio debe ser un número positivo.' });
  }

  const updateData = {};
  if (numero !== undefined) updateData.numero = numero;
  if (tipo) updateData.tipo = tipo;
  if (precio !== undefined) updateData.precio = precio;
  // ===== CAMBIO: Ya no se actualiza imageUrls aquí (se eliminó la línea) =====

  try {
    const updatedHabitacion = await Habitacion.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!updatedHabitacion) {
      return res.status(404).json({ message: 'Habitación no encontrada.' });
    }
    res.json({ message: 'Datos de habitación actualizados con éxito.', habitacion: updatedHabitacion });
  } catch (error) { /* ... (manejo de error sin cambios) ... */
    if (error.code === 11000) { /*...*/ }
    if (error.name === 'ValidationError') { /*...*/ }
    console.error("❌ Error al actualizar habitación:", error);
    res.status(500).json({ message: 'Error al actualizar la habitación.', error: error.message });
  }
});

// DELETE /api/habitaciones/:id (Ahora también borra la carpeta de imágenes)
app.delete('/api/habitaciones/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { // <-- Buena práctica añadir validación de ID
    return res.status(400).send('ID de habitación inválido.');
  }
  try {
    const deletedHabitacion = await Habitacion.findByIdAndDelete(id);
    if (!deletedHabitacion) {
      return res.status(404).json({ message: 'Habitación no encontrada.' });
    }

    // ===== INICIO: Borrar carpeta de imágenes asociada =====
    const roomPath = path.join(__dirname, 'uploads', id.toString());
    try {
        console.log(`Intentando borrar carpeta: ${roomPath}`);
        await fs.rm(roomPath, { recursive: true, force: true }); // Borra la carpeta y su contenido
        console.log(`Carpeta de imágenes borrada: ${roomPath}`);
    } catch (rmError) {
        if (rmError.code === 'ENOENT') { // Si la carpeta no existe, no es un error fatal
             console.warn(`Advertencia: La carpeta ${roomPath} no existía al intentar borrarla.`);
        } else { // Otro error (ej. permisos)
            console.error(`Error al borrar la carpeta de imágenes ${roomPath}:`, rmError);
            // Considera si continuar o devolver un error parcial aquí
        }
    }
    // ===== FIN: Borrar carpeta de imágenes asociada =====

    // Opcional: Cancelar o desvincular reservas asociadas
    // await Reserva.updateMany({ habitacion: id }, { $set: { estado: 'cancelada', /* habitacion: null // Opcional */ } });

    res.json({ message: 'Habitación y sus imágenes asociadas eliminadas con éxito.' });
  } catch (error) {
    console.error(`❌ Error al eliminar habitación ${id}:`, error);
    res.status(500).json({ message: 'Error interno al eliminar la habitación.', error: error.message });
  }
});


// Rutas de Menú
app.get('/api/menu/categorias', async (req, res) => {
  try {
    const categorias = await Categoria.find({}).sort({ nombre: 1 });
    res.json(categorias);
  } catch (error) {
    console.error("❌ Error al obtener categorías:", error);
    res.status(500).json({ message: 'Error al obtener las categorías.', error: error.message });
  }
});

app.post('/api/menu/categorias', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) {
      return res.status(400).json({ message: 'El nombre de la categoría es obligatorio.' });
  }
  try {
    const nuevaCategoria = new Categoria({ nombre });
    await nuevaCategoria.save();
    res.status(201).json({ message: 'Categoría creada con éxito.', categoria: nuevaCategoria });
  } catch (error) {
     if (error.code === 11000) {
      return res.status(409).json({ message: `La categoría "${nombre}" ya existe.` });
    }
    console.error("❌ Error al crear categoría:", error);
     if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos.', errors: error.errors });
    }
    res.status(500).json({ message: 'Error al crear la categoría.', error: error.message });
  }
});
// Faltan PUT y DELETE para Categorias

app.get('/api/menu/items', async (req, res) => {
  try {
    const { categoriaId } = req.query;
    let query = {};
    if (categoriaId) {
      // Validar que sea un ObjectId válido si se filtra
      if (!mongoose.Types.ObjectId.isValid(categoriaId)) {
          return res.status(400).json({ message: 'ID de categoría inválido.' });
      }
      query.categoria = categoriaId;
    }
    const menuItems = await MenuItem.find(query).populate('categoria', 'nombre').sort({ nombre: 1 });
    res.json(menuItems);
  } catch (error) {
    console.error("❌ Error al obtener ítems:", error);
    res.status(500).json({ message: 'Error al obtener los ítems del menú.', error: error.message });
  }
});

app.post('/api/menu/items', async (req, res) => {
  const { nombre, descripcion, precio, categoria } = req.body;
  if (!nombre || precio === undefined || !categoria) {
      return res.status(400).json({ message: 'Nombre, precio y categoría son obligatorios.' });
  }
    if (typeof precio !== 'number' || precio < 0) {
      return res.status(400).json({ message: 'El precio debe ser un número positivo.' });
  }
    if (!mongoose.Types.ObjectId.isValid(categoria)) {
       return res.status(400).json({ message: 'ID de categoría inválido.' });
    }
  try {
    const catExists = await Categoria.findById(categoria);
    if (!catExists) {
        return res.status(404).json({ message: 'La categoría especificada no existe.' });
    }
    const nuevoItem = new MenuItem({ nombre, descripcion, precio, categoria });
    await nuevoItem.save();
    await nuevoItem.populate('categoria', 'nombre'); // Poblar antes de enviar
    res.status(201).json({ message: 'Ítem del menú creado con éxito.', item: nuevoItem });
  } catch (error) {
    console.error("❌ Error al crear ítem:", error);
     if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos para el ítem.', errors: error.errors });
    }
    res.status(500).json({ message: 'Error al crear el ítem del menú.', error: error.message });
  }
});

app.put('/api/menu/items/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, categoria } = req.body;
  if (precio !== undefined && (typeof precio !== 'number' || precio < 0)) {
      return res.status(400).json({ message: 'El precio debe ser un número positivo.' });
  }
    if (categoria && !mongoose.Types.ObjectId.isValid(categoria)) {
       return res.status(400).json({ message: 'ID de categoría inválido.' });
    }
  try {
    if (categoria) {
        const catExists = await Categoria.findById(categoria);
        if (!catExists) {
            return res.status(404).json({ message: 'La nueva categoría especificada no existe.' });
        }
    }
    const updateData = {};
    if (nombre) updateData.nombre = nombre;
    if (descripcion !== undefined) updateData.descripcion = descripcion;
    if (precio !== undefined) updateData.precio = precio;
    if (categoria) updateData.categoria = categoria;

    const updatedItem = await MenuItem.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
        .populate('categoria', 'nombre'); // Poblar al actualizar también
    if (!updatedItem) {
        return res.status(404).json({ message: 'Ítem no encontrado.' });
    }
    res.json({ message: 'Ítem del menú actualizado con éxito.', item: updatedItem });
  } catch (error) {
    console.error("❌ Error al actualizar ítem:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Datos inválidos para actualizar.', errors: error.errors });
    }
    res.status(500).json({ message: 'Error al actualizar el ítem del menú.', error: error.message });
  }
});

app.delete('/api/menu/items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deletedItem = await MenuItem.findByIdAndDelete(id);
    if (!deletedItem) {
        return res.status(404).json({ message: 'Ítem no encontrado.' });
    }
    res.json({ message: 'Ítem del menú eliminado con éxito.' });
  } catch (error) {
    console.error("❌ Error al eliminar ítem:", error);
    res.status(500).json({ message: 'Error al eliminar el ítem del menú.', error: error.message });
  }
});


// Ruta de Estadísticas
app.get('/api/stats/reservas', async (req, res) => {
  try {
    // Obtener estadísticas de Reservas
    const statsReservas = await Reserva.aggregate([
      { $group: {
          _id: '$estado',
          count: { $sum: 1 },
          totalIncome: { $sum: { $cond: [{ $eq: ['$estado', 'confirmada'] }, '$precioTotal', 0] } }
        }
      },
      { $project: { _id: 0, estado: '$_id', count: 1, totalIncome: 1 }}
    ]);

    // Obtener estadísticas de Eventos (opcional, si quieres incluirlas)
    const statsEventos = await Evento.aggregate([
        { $group: {
            _id: '$estado',
            count: { $sum: 1 },
            totalIncome: { $sum: { $cond: [{ $eq: ['$estado', 'confirmado'] }, '$monto', 0] } }
        }},
        { $project: { _id: 0, estado: '$_id', count: 1, totalIncome: 1 }}
    ]);

    // Inicializar estadísticas formateadas
    const formattedStats = {
      totalReservas: 0,
      totalIngresosReservas: 0, // Ingresos solo de reservas de cuarto
      reservasPorEstado: { confirmada: 0, pendiente: 0, cancelada: 0 },
      totalEventos: 0,
      totalIngresosEventos: 0, // Ingresos solo de eventos
      eventosPorEstado: { confirmado: 0, pendiente: 0, cancelado: 0 },
      totalHabitaciones: 0,
    };

    // Llenar estadísticas de Reservas
    statsReservas.forEach(stat => {
      formattedStats.totalReservas += stat.count;
      if (formattedStats.reservasPorEstado.hasOwnProperty(stat.estado)) {
        formattedStats.reservasPorEstado[stat.estado] = stat.count;
      }
      formattedStats.totalIngresosReservas += stat.totalIncome;
    });

     // Llenar estadísticas de Eventos
    statsEventos.forEach(stat => {
      formattedStats.totalEventos += stat.count;
      if (formattedStats.eventosPorEstado.hasOwnProperty(stat.estado)) {
        formattedStats.eventosPorEstado[stat.estado] = stat.count;
      }
      formattedStats.totalIngresosEventos += stat.totalIncome;
    });

    // Obtener el total de habitaciones
    formattedStats.totalHabitaciones = await Habitacion.countDocuments();

    res.json(formattedStats);
  } catch (error) {
    console.error("❌ Error al obtener estadísticas:", error);
    res.status(500).json({ message: 'Error al obtener las estadísticas.', error: error.message });
  }
});

// Ruta de Configuración de Contacto
app.get('/api/config/contacto', async (req, res) => {
    try {
        // Buscar por el identificador único
        const config = await Config.findOne({ identificador: 'configuracion-principal' });
        if (!config) {
            console.warn("Advertencia: Configuración de contacto no encontrada en la BD.");
            // Devolver un default o error
            return res.status(404).json({ message: 'Configuración de contacto no encontrada.' });
        }
        res.json({ whatsappUrl: config.whatsappUrl }); // Devolver solo lo necesario
    } catch (error) {
        console.error("❌ Error al obtener config contacto:", error);
        res.status(500).json({ message: 'Error al obtener la configuración de contacto.', error: error.message });
    }
});
// Faltaría una ruta PUT /api/config/contacto si quieres poder editarla desde el panel

// Rutas para Generar Contratos en PDF
app.get('/api/reservas/:id/contrato', async (req, res) => {
  try {
    const { id } = req.params;
    const tipo = 'contrato_tipo1'; // Asumimos que este es el contrato de hospedaje

    // Validar ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).send('ID de reserva inválido.');
    }

    const reserva = await Reserva.findById(id).populate('habitacion').populate('usuario');
    if (!reserva) {
      return res.status(404).send('Reserva no encontrada');
    }

    if (!reserva.habitacion) {
        console.error(`Error Crítico: Reserva ${id} no tiene habitación asociada.`);
        return res.status(500).send('Error interno: Datos de habitación faltantes para esta reserva.');
    }

    const plantillaPath = path.join(__dirname, 'contratos', `${tipo}.html`);
    try {
        await fs.access(plantillaPath);
    } catch (fsError) {
        console.error(`Error Fatal: Plantilla de contrato no encontrada en ${plantillaPath}`);
        return res.status(500).send(`Plantilla de contrato '${tipo}' no encontrada en el servidor.`);
    }

    let html = await fs.readFile(plantillaPath, 'utf-8');

    const datos = {
        nombreHuesped: reserva.nombreHuesped || (reserva.usuario ? reserva.usuario.username : 'Huésped Público'),
        nombreHabitacion: `No. ${reserva.habitacion.numero} (${reserva.habitacion.tipo})`,
        fechaInicio: new Date(reserva.fechaInicio).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
        fechaFin: new Date(reserva.fechaFin).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
        precioTotal: reserva.precioTotal ? reserva.precioTotal.toFixed(2) : '0.00',
        tipoPago: reserva.tipoPago || 'No especificado',
        fechaActual: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
    };

    for (const key in datos) {
        const value = datos[key] ?? ''; // Usar '' si es null o undefined
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    let browser = null; // Definir fuera del try
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] // Añadido flag común
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' } }); // Añadir márgenes

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=contrato-reserva-${reserva._id}.pdf`); // inline para previsualizar
        res.send(pdfBuffer);

    } catch (puppeteerError) {
        console.error('❌ Error específico de Puppeteer:', puppeteerError);
        // Devolver un error más específico si es posible
        res.status(500).send(`Error al generar el PDF con Puppeteer: ${puppeteerError.message}`);
    } finally {
        if (browser) {
            await browser.close(); // Asegurarse de cerrar el navegador
        }
    }

  } catch (error) {
    console.error('❌ Error general al generar PDF de reserva:', error);
    res.status(500).send(`Error general al generar el contrato en PDF. Detalles: ${error.message}.`);
  }
});

app.get('/api/eventos/:id/contrato', async (req, res) => {
    try {
        const { id } = req.params;
         if (!mongoose.Types.ObjectId.isValid(id)) {
             return res.status(400).send('ID de evento inválido.');
         }

        const evento = await Evento.findById(id);
        if (!evento) return res.status(404).send('Evento no encontrado.');

        const plantillaPath = path.join(__dirname, 'contratos', 'contrato_area_social.html');
        try {
            await fs.access(plantillaPath);
        } catch (fsError) {
            console.error(`Error Fatal: Plantilla de evento no encontrada en ${plantillaPath}`);
            return res.status(500).send(`Plantilla de contrato de área social no encontrada en el servidor.`);
        }

        let html = await fs.readFile(plantillaPath, 'utf-8');

        const datos = {
            cliente: evento.nombreCliente || 'Cliente no especificado',
            fechaEvento: evento.fechaEvento ? new Date(evento.fechaEvento).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Fecha no especificada',
            area: evento.areaRentada || 'Área no especificada',
            monto: evento.monto ? evento.monto.toFixed(2) : '0.00',
        };

        for (const key in datos) {
            const value = datos[key] ?? '';
            html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        let browser = null;
        try {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' } }); // Márgenes consistentes

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=contrato-evento-${evento._id}.pdf`); // inline
            res.send(pdfBuffer);

        } catch (puppeteerError) {
            console.error('❌ Error específico de Puppeteer:', puppeteerError);
             res.status(500).send(`Error al generar el PDF del evento con Puppeteer: ${puppeteerError.message}`);
        } finally {
            if (browser) {
                await browser.close();
            }
        }

    } catch (error) {
        console.error('❌ Error general al generar PDF del evento:', error);
        res.status(500).send(`Error general al generar el contrato del evento. Detalles: ${error.message}.`);
    }
});

// --- MANEJADORES DE ERROR (AL FINAL) ---
// Middleware para manejar errores 404 (rutas no encontradas)
app.use((req, res, next) => {
    console.log(`404 - Ruta no encontrada para: ${req.originalUrl}`); // Log adicional
    res.status(404).json({ message: 'Ruta no encontrada.' });
});

// Middleware para manejar otros errores del servidor (debe ir al final)
app.use((err, req, res, next) => {
    console.error("❌ Error no controlado:", err.stack);
    const errorMessage = process.env.NODE_ENV === 'production' ? 'Ocurrió un error inesperado.' : err.message;
    res.status(err.status || 500).json({ message: 'Error interno del servidor.', error: errorMessage });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en http://localhost:${PORT}`);
  console.log('Sirviendo imágenes estáticas desde:', path.join(__dirname, 'uploads')); // Log de verificación
});