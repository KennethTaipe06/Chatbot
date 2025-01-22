const { handleChatbotRequest } = require('../controllers/chatbotController');

function setupRoutes(app, redisClient) {
    app.post('/chatbot', (req, res) => handleChatbotRequest(req, res, redisClient));
}

module.exports = { setupRoutes };
