import { createClient } from 'redis'
const client = createClient({
    url: 'redis://127.0.0.1:6379'
});

client.on('error', err => console.error('Redis Client Error', err));

// Подключаемся один раз при старте
await client.connect();

export const redis = client;