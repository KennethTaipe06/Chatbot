async function connectRedis(redisClient) {
    try {
        await redisClient.connect();
        console.log('Conectado a Redis');
    } catch (error) {
        console.error('Error connecting to Redis', error);
        throw error;
    }
}

module.exports = { connectRedis };
