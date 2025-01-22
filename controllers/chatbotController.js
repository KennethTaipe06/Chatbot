const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const SECRET_KEY = process.env.SECRET_KEY;

async function handleChatbotRequest(req, res, redisClient) {
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
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
                const prompt = conversationHistory.map(entry => `${entry.sender}: ${entry.message}`).join('\n');
                console.log('Prompt generado:', prompt);
                const result = await model.generateContent(prompt);
                const botMessage = await result.response.text();

                // Agregar el mensaje del bot al historial de conversación
                conversationHistory.push({ sender: 'bot', message: botMessage });

                // Guardar el historial de conversación actualizado en Redis con una duración máxima de una hora
                await redisClient.set(`history_${userId}`, JSON.stringify(conversationHistory), 'EX', 3600);

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
}

module.exports = { handleChatbotRequest };
