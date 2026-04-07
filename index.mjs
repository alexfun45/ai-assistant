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
        [{ text: "🛒 Показать корзину"}, { text: "📄 Сформировать КП" }],
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


async function showCart(ctx) {
  const session = ctx.session;

  if (!session.cart || session.cart.length === 0) {
    return ctx.reply("🛒 Ваша корзина пока пуста. Найти что-нибудь?");
  }

  // 1. Сначала удаляем старое сообщение, если это был клик по кнопке, 
  // чтобы не забивать чат дублями при перерисовке всей корзины
  if (ctx.updateType === 'callback_query') {
    try { await ctx.deleteMessage(); } catch (e) {}
  }

  let totalSum = 0;

  // 2. Проходим циклом по товарам и отправляем КАЖДЫЙ отдельным сообщением
  for (const item of session.cart) {
    const itemTotal = item.price * (item.quantity || 1);
    totalSum += itemTotal;

    const message = `📦 **${item.name}**\n💰 ${item.price} руб. x ${item.quantity} шт. = ${itemTotal} руб.`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('➖', `cart_minus_${item.id}`),
        Markup.button.callback(`${item.quantity} шт.`, `ignore`),
        Markup.button.callback('➕', `cart_plus_${item.id}`),
        Markup.button.callback('❌', `cart_del_${item.id}`)
      ]
    ]);

    await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
  }

  // 3. Финальное сообщение с итогом и общими кнопками
  const finalMessage = `ИТОГО К ОПЛАТЕ: **${totalSum} руб.**`;
  const finalKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🧹 Очистить всё', 'cart_clear')],
    [Markup.button.callback('📄 Оформить заказ', 'cart_checkout')]
  ]);

  await ctx.reply(finalMessage, { parse_mode: 'Markdown', ...finalKeyboard });
}

async function showCart2(ctx){
  const session = ctx.session;
  if (!session.cart || session.cart.length === 0) {
    ctx.reply("Ваша корзина пока пуста. Найти что-нибудь?");
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

async function createProductListButtons(ctx, products){

  const keyboard = [];
  
  for (const item of products) {
    const message = `📦 **${item.name}**\n💰 Цена: ${item.price} руб.`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить в расчет', `tocart_${item.id}`)]
    ]);

    await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
  }

  // В конце можно прислать кнопку возврата
  await ctx.reply('---', Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Вернуться в каталог', 'catalog_main')]
  ]));
}

async function make_kp(){

}

async function clear_cart(ctx){
  ctx.session.cart = [];
  ctx.session.state = STATES.IDLE;
  await ctx.reply('Ваша корзина очищена');
}

function findProduct(id){
  return priceData.find(p => String(p.id) === String(id));
};

bot.action(/^tocart_(.+)$/, async(ctx) => {
  const productId = ctx.match[1];
  const item = ctx.session.cart.find(p => String(p.id) === productId);
  const productInfo = findProduct(productId);
  const pendingAction = { type: 'ADD', quantity: 1, ...productInfo};
  const isChanged = ctx.session.cart.some((item, index, arr)=>{
      if(item.productId==productId){
          item.quantity++;
          item.price*2;
          return true;
        }
      })
      if(!isChanged) 
          ctx.session.cart.push(pendingAction);
    ctx.reply('Товар добавлен в корзину');
})

bot.action(/^cat_(.+)$/, async (ctx) => {
  const categoryId = ctx.match[1];
  const products = priceData.filter(p => p.category === categoryId);
  createProductListButtons(ctx, products);
  //keyboard.push([Markup.button.callback('⬅️ Назад в категории', '📦 Каталог товаров')]);
  //await ctx.reply(`Товары в категории ${categoryId}:`, Markup.inlineKeyboard(keyboard));
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

  const menuButtons = ['📦 Каталог товаров', '🛒 Показать корзину', '🧹 Очистить', '📄 Сформировать КП'];
  
  if (menuButtons.includes(messageText)) {
    
    // Вызываем функции навигации БЕЗ ИИ
    if (messageText === '📦 Каталог товаров') return showCategories(ctx);
    if (messageText === '🛒 Показать корзину'){ return showCart(ctx);}
    if (messageText === '📄 Сформировать КП'){ return make_kp(ctx);}
    if (messageText === "🧹 Очистить") return clear_cart(ctx);
    return;
  }
  const res = await ai_service.handleUserMessage(ctx);
  ctx.reply(res.message);
});