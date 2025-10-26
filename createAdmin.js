// Archivo: createAdmin.js (VERSIÓN FINAL)

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
// --- CORRECCIÓN AQUÍ ---
// Se añade el prefijo "node:" para importar módulos nativos de Node.js
import readline from 'node:readline';

// 1. Definimos el ESQUEMA (Debe ser idéntico al de server.js)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true, default: 'usuario' },
  telefono: {
    type: String,
    unique: true,
    sparse: true,
    validate: {
      validator: (v) => v === null || v === '' || /^\d{10}$/.test(v),
      message: props => `${props.value} no es un número de teléfono válido.`,
    },
  },
});

// 2. Añadimos el MÉTODO para hashear la contraseña ANTES de compilar el modelo
userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

// 3. Compilamos el MODELO a partir del esquema ya configurado
const User = mongoose.model('User', userSchema);

// URL de conexión a tu base de datos
const dbUrl = 'mongodb://localhost:27017/palapalacasona';

// --- Función principal para crear el admin ---
const createAdminUser = async () => {
  let connection;
  try {
    connection = await mongoose.connect(dbUrl);
    console.log('Conectado a MongoDB para crear el administrador.');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const username = await new Promise(resolve => rl.question('Introduce el nombre de usuario para el admin (ej. admin): ', resolve));
    const password = await new Promise(resolve => rl.question(`Introduce la nueva contraseña para "${username}": `, resolve));
    
    rl.close();

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ username: username });
    if (existingUser) {
      console.log(`El usuario "${username}" ya existe. No se ha creado nada.`);
      return;
    }

    // Crear la nueva instancia de usuario
    const adminUser = new User({
      username: username,
      password: password,
      role: 'admin'
    });
    
    console.log('Usuario creado, procediendo a hashear y guardar...');

    // Guardar el nuevo usuario en la base de datos
    await adminUser.save();
    console.log(`✅ ¡Usuario administrador "${username}" creado exitosamente!`);

  } catch (error) {
    console.error('❌ Error al crear el usuario administrador:', error.message);
  } finally {
    if (connection) {
      await mongoose.disconnect();
      console.log('Desconectado de MongoDB.');
    }
  }
};

// Ejecutar la función
createAdminUser();