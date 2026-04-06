import 'dotenv/config'
import { GoogleSpreadsheet } from 'google-spreadsheet'
//import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
//import { Ollama } from "@langchain/ollama"
import { JWT } from 'google-auth-library'
import { z } from "zod";
import { getPriceData, getDiscount, getCategories } from './lib/sheets.mjs'
import { PromptTemplate } from '@langchain/core/prompts'
import telegraf from 'telegraf';
import { session } from 'telegraf';
import { Redis } from '@telegraf/session/redis';
import { initRedis } from './services/redis.service.mjs';
import aiService from './services/ai.service.mjs'
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { createClient } from 'redis';

const { Telegraf, Markup } = telegraf;

const proxyAgent = new HttpsProxyAgent('http://user361622:lw0kic@45.91.9.172:5972');

//async function launch() {
  const connectedClient = await initRedis(); // Сначала подключаем базу
  const client = createClient({ url: 'redis://localhost:6379' });
  const store = Redis({
    connectedClient
    }
  );

  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
    telegram: { agent: proxyAgent }
  });

  bot.use(session({ store }));
  
  bot.launch();
  console.log('Бизнес-ассистент запущен!');
  bot.start((ctx) => ctx.reply('Добро пожаловать в бот умного ассистента! Задайте вопрос какой товар вы бы хотели найти',
     {
    
    reply_markup: {
      keyboard: [
        [{text: "📦 Каталог товаров"}],
        [{ text: "🛒 Показать корзину"}, { text: "📄 Сформировать PDF" }],
        [{ text: "❓ Помощь" }, { text: "🧹 Очистить" }]
      ],
      resize_keyboard: true // Чтобы кнопки были аккуратными, а не на пол-экрана
    }
  }));

//await launch().catch(console.error);

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


const [priceContext, priceData] = await getPriceData();
const ai_service = new aiService(priceData, priceContext);

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


async function showCart(ctx){
  console.log('корзина');
  const session = ctx.session;
  if (!session.cart || session.cart.length === 0) {
    return { message: "Ваша корзина пока пуста. Найти что-нибудь?" };
  }

  let totalSum = 0;
  const keyboard = [];
  
  const cartLines = session.cart.map((item, index) => {
    const itemTotal = item.price * (item.quantity || 1);
    totalSum += itemTotal;

    // Создаем строку кнопок для каждого товара: [ - ] [ кол-во ] [ + ] [ ❌ ]
    keyboard.push([
      Markup.button.callback('➖', `cart_minus_${item.id}`),
      Markup.button.callback(`${item.quantity} шт.`, `ignore`), // Просто текст
      Markup.button.callback('➕', `cart_plus_${item.id}`),
      Markup.button.callback('❌', `cart_del_${item.id}`)
    ]);

    return `${index + 1}. **${item.name}**\n   ${item.price} руб. x ${item.quantity} = ${itemTotal} руб.`;
  });

  // Добавляем финальные кнопки под списком
  keyboard.push([Markup.button.callback('🧹 Очистить всё', 'cart_clear')]);
  keyboard.push([Markup.button.callback('📄 Оформить заказ', 'cart_checkout')]);

  const report = `🛒 **Ваш текущий расчет:**\n\n${cartLines.join('\n\n')}\n\n**Итого: ${totalSum} руб.**`;

  // Если это вызов из кнопки, мы редактируем старое сообщение, если из меню — шлем новое
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(report, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
  } else {
    await ctx.reply(report, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
  }
}

bot.action(/^cart_plus_(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const item = ctx.session.cart.find(p => String(p.id) === productId);
  
  if (item) {
    item.quantity++;
    await showCart(ctx); // Обновляем сообщение корзины
  }
  await ctx.answerCbQuery();
});

// Уменьшение количества
bot.action(/^cart_minus_(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const item = ctx.session.cart.find(p => String(p.id) === productId);
  
  if (item && item.quantity > 1) {
    item.quantity--;
    await showCart(ctx);
  } else {
    await ctx.answerCbQuery('Минимум 1 шт. Используйте ❌ для удаления');
  }
  await ctx.answerCbQuery();
});

// Удаление одной позиции
bot.action(/^cart_del_(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  ctx.session.cart = ctx.session.cart.filter(p => String(p.id) !== productId);
  
  await showCart(ctx);
  await ctx.answerCbQuery('Товар удален');
});

// Полная очистка
bot.action('cart_clear', async (ctx) => {
  ctx.session.cart = [];
  await ctx.editMessageText('🛒 Корзина очищена');
  await ctx.answerCbQuery();
});

bot.hears('🛒 Показать корзину', showCart);

async function showCategories(ctx){
  const categories = await getCategories();
  const keys = Object.keys(categories);
  
  const categoryButtons = keys.map(cat => Markup.button.callback(cat, `cat_${cat}`));

  await ctx.reply('Выберите категорию товаров из нашего склада:', 
    Markup.inlineKeyboard(categoryButtons)
  );
}

function createProductListButtons(products){
  return products.map((product)=>{
    return [
      Markup.button.callback(
        `${product.name} — ${product.price} руб.`, 
        `cart_${product.id}`
      )
    ];
  }
  )
}

async function clear_cart(ctx){
  console.log('очистить корзину');
  ctx.session.cart = [];
  ctx.session.state = STATES.IDLE;
  await ctx.reply('Ваша корзина очищена');
}

bot.action(/^cat_(.+)$/, async (ctx) => {
  const categoryId = ctx.match[1];
  // Фильтруем прайс по категории и выдаем список товаров с кнопками [add_ID]
  const products = priceData.filter(p => p.category === categoryId);
  const keyboard = createProductListButtons(products);
  keyboard.push([Markup.button.callback('⬅️ Назад в категории', '📦 Каталог товаров')]);
  await ctx.reply(`Товары в категории ${categoryId}:`, Markup.inlineKeyboard(keyboard));
});

bot.action('📦 Каталог товаров', showCategories);

bot.on('text', async (ctx) => {
 
  ctx.session ??= { state: STATES.IDLE, cart: [], chat: [], pendingItem: null, lastViewedProductId:null };
  ctx.session.cart ??= [];
  ctx.session.state ??= STATES.IDLE;
  ctx.session.chat ??= [];
  ctx.session.pendingItem ??= null;
  ctx.session.lastViewedProductId ??= null;

  const messageText = ctx.message.text;

  const menuButtons = ['📦 Каталог товаров', '🛒 Показать корзину', '🧹 Очистить', '📄 Оформить КП'];
  
  if (menuButtons.includes(messageText)) {
    
    // Вызываем функции навигации БЕЗ ИИ
    if (messageText === '📦 Каталог товаров') return showCategories(ctx);
    if (messageText === '🛒 Показать корзину'){ console.log('grw'); return showCart(ctx);}
    if (messageText === "🧹 Очистить") return clear_cart(ctx);
    return;
  }
  const res = await ai_service.handleUserMessage(ctx);
  ctx.reply(res.message);
  /*if(ai_mod){
    let res = await handleUserMessage(ctx);
    if(res)
      ctx.reply(res.message);
  }*/
});
//console.log('Бизнес-ассистент запущен!');
