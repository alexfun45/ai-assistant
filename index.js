import 'dotenv/config'
import { GoogleSpreadsheet } from 'google-spreadsheet'
//import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
//import { Ollama } from "@langchain/ollama"
import { JWT } from 'google-auth-library'
import { z } from "zod";
import { getPriceData, getDiscount, getCategories } from './lib/sheets.js'
import { PromptTemplate } from '@langchain/core/prompts'
import { Telegraf } from 'telegraf'
import Redis from 'telegraf-session-redis';
import { redis } from './services/redis.service.js';
import { Markup } from 'telegraf';
import ai_service from './services/ai.service.js'
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { session } from 'telegraf';

const sessions = {};
const store = Redis({
  client: redis
});


const STATES = {
  IDLE: 'IDLE',                   // Просто общение / поиск
  CONFIRMING_ADD: 'CONFIRMING_ADD', // Ждем подтверждения добавления в расчет
  COLLECTING_DATA: 'COLLECTING_DATA' // Собираем данные для КП (ФИО, почта)
};

// 1. Настройка Google Auth
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

//const proxyAgent = new HttpsProxyAgent('http://user361622:lw0kic@45.91.9.172:5972');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  telegram: {
    agent: proxyAgent
  }
});

bot.use(session({ store }));

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

const discounts = await getDiscount();

/*
const responseSchema = z.object({
  intent: z.enum(["search", "add_to_cart", "confirm", "cancel", "greeting", "view_cart"])
    .describe(`
    Классификация намерения:
    - search: поиск товара или вопрос о цене/наличии.
    - add_to_cart: четкое желание добавить товар в расчет (например "Добавь 5 штук").
    
    - cancel: отказ или просьба удалить ("Нет", "Удали", "Не надо").
    - view_cart: просьба показать текущий список товаров в расчете или итоговую сумму.
    - greeting: простое приветствие.
    `),
  productId: z.string().optional()
    .describe("Артикул товара из прайса (только цифры/ID)"),
  quantity: z.number().optional().default(1)
    .describe("Количество товара, которое упомянул пользователь"),
  text: z.string()
    .describe("Твой вежливый ответ пользователю на русском языке")
});

const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000", // Обязательно для OpenRouter
      "X-OpenRouter-Title": "Biz Assistant Project",
      'Content-Type': 'application/json',
    },
  },
  model: "google/gemini-3.1-flash-lite-preview", 
  temperature: 0.3,
}); 

const structuredModel = model.withStructuredOutput(responseSchema);*/


/*const template = ChatPromptTemplate.fromMessages([
  ['system', "Ты — умный бизнес-ассистент. Ответь вежливо, используя данные из конекста. Если товара нет, предложи альтернативу"],
  ['human', 'Context: {context}'],
  ['human', 'Question: {question}'],
])*/

 const userSessions = {};

 const template = PromptTemplate.fromTemplate(`
  Ты — ядро системы «Умный Склад». Ответь вежливо, используя данные из контекста. 
  Твоя задача: анализировать запрос и возвращать данные строго по схеме.
  Если пользователь ищет подходящий товар назови название подходящего товара, его стоимость и артикул товара. Спроси: Добавить в расчет? 
  Если подходящего товара нет, можешь предложить наиболее близкий аналог но только из существующих позиций в контексте, указав что по данным критериям среди текущих позиций ты найти не смог, но можешь предложить наиболее подходящий вариант. 
  Если похожих аналогов нет, то скажи что по заданному запросу ничего не можешь найти.
  Если пользователь подтверждает добавление товара, но не называет артикул заново, используй артикул из предыдущего сообщения AI в истории диалога.
  Контекст Прайса: {context}
  История последних сообщений:
  {chat_history}
  \n
  Текущий запрос пользователя: {question}
  Ответ в формате JSON:
 `);

const getChatHistoryString = (userSessions) => {
  if (!userSessions) return "История пуста.";
  // Берем последние 6 реплик, чтобы не раздувать контекст
  return userSessions.chat.slice(-6).join("\n");
};

bot.start((ctx) => ctx.reply('Добро пожаловать в бот умного ассистента! Задайте вопрос какой товар вы бы хотели найти', {
  reply_markup: {
    keyboard: [
      [{text: "📦 Каталог товаров"}],
      [{ text: "🛒 Показать корзину" }, { text: "📄 Сформировать PDF" }],
      [{ text: "❓ Помощь" }, { text: "🧹 Очистить" }]
    ],
    resize_keyboard: true // Чтобы кнопки были аккуратными, а не на пол-экрана
  }
}))
const [priceContext, priceData] = await getPriceData();

const handleUserMessage = async (ctx) => {
  const userId = ctx.message.from.id;
  // 1. Получаем или создаем сессию
  if (!sessions[userId]) {
      sessions[userId] = { state: STATES.IDLE, chat: [], cart: [], pendingItem: null };
  }
  const session = sessions[userId];
  //const history = session.chat;
  const userQuery = ctx.message.text;
  const chatHistory = getChatHistoryString(session);
  const prompt = await template.invoke({
    context: priceContext,
    chat_history: chatHistory,
    question: userQuery
  });
  const aiRes = await structuredModel.invoke(prompt);
  sessions[userId].chat.push(aiRes.text);
  return handleIntent(session, aiRes);
}

const findProduct = (id) => {
  return priceData.find(p => String(p.id) === String(id));
};



function showCart(ctx){
  const userId = ctx.message.from.id;
  // 1. Получаем или создаем сессию
  if (!sessions[userId]) {
      sessions[userId] = { state: STATES.IDLE, chat: [], cart: [], pendingItem: null };
  }
  const session = sessions[userId];
  if (!session.cart || session.cart.length === 0) {
    return { message: "Ваша корзина пока пуста. Найти что-нибудь?" };
  }

  let totalSum = 0;
  // Формируем текстовый список
  const cartLines = session.cart.map((item, index) => {
    const itemTotal = item.price * item.quantity;
    totalSum += itemTotal;
    return `${index + 1}. ${item.name} — ${item.quantity} шт. x ${item.price} руб. = ${itemTotal} руб.`;
  });

  const report = `🛒 **Ваш текущий расчет:**\n\n${cartLines.join('\n')}\n\n**Итого: ${totalSum} руб.**\n\n`;
  ctx.reply(report);
  ai_mod = true;
}

bot.hears('🛒 Мой заказ', showCart);

async function showCategories(ctx){
  const categories = getCategories();
  const categoryButtons = categories.map(cat => [
    Markup.button.callback(cat, `view_cat_${cat}`) 
  ]);

  await ctx.reply('Выберите категорию товаров из нашего склада:', 
    Markup.inlineKeyboard(categoryButtons)
  );
}

bot.on('text', async (ctx) => {

  const menuButtons = ['📦 Каталог', '🛒 Мой расчет', '📄 Оформить КП'];

  if (menuButtons.includes(messageText)) {
    // Вызываем функции навигации БЕЗ ИИ
    if (messageText === '📦 Каталог') return showCategories(ctx);
    if (messageText === '🛒 Мой заказ') return showCart(ctx);
    return;
  }

  /*if(ai_mod){
    let res = await handleUserMessage(ctx);
    if(res)
      ctx.reply(res.message);
  }*/
});

bot.launch();
console.log('Бизнес-ассистент запущен!');
