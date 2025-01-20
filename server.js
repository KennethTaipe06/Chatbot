require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const redis = require('redis');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de Swagger
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Chatbot API',
            version: '1.0.0',
            description: 'API para comunicarse con el chatbot de Gemini'
        },
        servers: [
            {
                url: `http://localhost:${port}`
            }
        ]
    },
    apis: ['./server.js']
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Middleware
app.use(bodyParser.json());
app.use(cors());

const redisClient = redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});

redisClient.on('error', (err) => {
    console.error('Error connecting to Redis', err);
});

// Conectar el cliente de Redis y luego iniciar el servidor
redisClient.connect().then(() => {
    console.log('Conectado a Redis');

    app.listen(port, () => {
        console.log(`Servidor escuchando en http://localhost:${port}`);
    });
}).catch(console.error);

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const SECRET_KEY = process.env.SECRET_KEY;

/**
 * @swagger
 * /chatbot:
 *   post:
 *     summary: Enviar un mensaje al chatbot
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           example: "user123"
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *           example: "jwt-token"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 example: "Hola, ¿cómo estás?"
 *     responses:
 *       200:
 *         description: Respuesta del chatbot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userMessage:
 *                   type: string
 *                   example: "Hola, ¿cómo estás?"
 *                 botMessage:
 *                   type: string
 *                   example: "Hola, estoy bien. ¿Y tú?"
 *                 description:
 *                   type: string
 *                   example: "Mensaje recibido y procesado correctamente."
 *       400:
 *         description: userId y token son requeridos
 *       401:
 *         description: Token inválido o Token JWT inválido
 *       500:
 *         description: Error al comunicarse con el chatbot o Error al acceder a Redis
 */
app.post('/chatbot', async (req, res) => {
    const { userId, token } = req.query;
    const { message } = req.body;

    console.log('Solicitud recibida:', { userId, token, message });

    if (!userId || !token) {
        console.log('userId o token faltante');
        return res.status(400).json({ error: 'userId y token son requeridos' });
    }

    try {
        const storedToken = await redisClient.get(userId);

        console.log('Token almacenado en Redis:', storedToken);

        if (storedToken !== token) {
            console.log('Token inválido');
            return res.status(401).json({ error: 'Token inválido' });
        }

        jwt.verify(token, SECRET_KEY, async (err, decoded) => {
            if (err) {
                console.log('Token JWT inválido:', err);
                return res.status(401).json({ error: 'Token JWT inválido', details: err.message });
            }

            console.log('Token JWT verificado:', decoded);

            // Obtener historial de conversación del usuario desde Redis
            let conversationHistory = await redisClient.get(`history_${userId}`);
            conversationHistory = conversationHistory ? JSON.parse(conversationHistory) : [];

            // Agregar el mensaje del usuario al historial de conversación
            conversationHistory.push({ sender: 'user', message: message });

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
                const prompt = conversationHistory.map(entry => `${entry.sender}: ${entry.message}`).join('\n');
                console.log('Prompt generado:', prompt);
                const result = await model.generateContent(prompt);
                const botMessage = await result.response.text();

                // Agregar el mensaje del bot al historial de conversación
                conversationHistory.push({ sender: 'bot', message: botMessage });

                // Guardar el historial de conversación actualizado en Redis
                await redisClient.set(`history_${userId}`, JSON.stringify(conversationHistory));

                console.log('Respuesta del bot:', botMessage);

                res.json({ 
                    userMessage: message,
                    botMessage: botMessage,
                    description: 'Mensaje recibido y procesado correctamente.'
                });
            } catch (error) {
                console.error('Error al comunicarse con el chatbot:', error);
                res.status(500).json({ 
                    error: 'Error al comunicarse con el chatbot',
                    details: error.message
                });
            }
        });
    } catch (error) {
        console.error('Error al procesar la solicitud:', error);
        res.status(500).json({ 
            error: 'Error al procesar la solicitud',
            details: error.message
        });
    }
});
