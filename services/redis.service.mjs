import { createClient } from 'redis';

let client = null;

export const initRedis = async () => {
    if (!client) {
        client = createClient({
            url: 'redis://127.0.0.1:6379'
        });
        client.on('error', (err) => {
            if (!err.message.includes('Socket already opened')) {
                console.error('Redis Error:', err);
            }
        });
    }

    // Если клиент уже открыт библиотекой сессий, просто возвращаем его
    if (client.isOpen) {
        return client;
    }

    try {
        console.log('connect socket');
        await client.connect();
        console.log('🚀 Redis подключен вручную');
    } catch (err) {
        if (err.message.includes('Socket already opened')) {
            // Игнорируем: значит Telegraf успел подключиться первым
        } else {
            throw err;
        }
    }
    return client;
};

export { client as redis };