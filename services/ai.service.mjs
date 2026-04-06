import 'dotenv/config'
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod";
import { PromptTemplate } from '@langchain/core/prompts'
import { HttpsProxyAgent } from 'https-proxy-agent';

const STATES = {
  IDLE: 'IDLE',                   // Просто общение / поиск
  CONFIRMING_ADD: 'CONFIRMING_ADD', // Ждем подтверждения добавления в расчет
  COLLECTING_DATA: 'COLLECTING_DATA' // Собираем данные для КП (ФИО, почта)
};

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

const structuredModel = model.withStructuredOutput(responseSchema);

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

class aiService{

  proxyAgent = new HttpsProxyAgent('http://user361622:lw0kic@45.91.9.172:5972');

  constructor(priceData, priceContext){
    this.priceData = priceData;
    this.priceContext = priceContext;
  }

  // получение истории чата
  getChatHistoryString(userSessions){
    console.log('userSessions', userSessions);
    if (!userSessions) return "История пуста.";
    // Берем последние 6 реплик, чтобы не раздувать контекст
    return userSessions.chat.slice(-6).join("\n");
  };

  // обработка сообщения пользователя
  handleUserMessage = async (ctx) => {
    const userId = ctx.message.from.id;
    // 1. Получаем или создаем сессию
    //const sessionData = await redis.get(`session:${userId}`);
    //const session = sessionData ? JSON.parse(sessionData) : {state: STATES.IDLE, cart: [], chat: [], pendingItem: null, lastViewedProductId:null };
    const session = ctx.session;
    //const history = session.chat;
    const userQuery = ctx.message.text;
    const chatHistory = this.getChatHistoryString(session);
    const prompt = await template.invoke({
      context: this.priceContext,
      chat_history: chatHistory,
      question: userQuery
    });
    const aiRes = await structuredModel.invoke(prompt);
    console.log(aiRes);
    session.chat.push(`Human: ${userQuery}`, `AI: ${aiRes.text}`);
    return this.handleIntent(session, aiRes);
}

findProduct(id){
  return this.priceData.find(p => String(p.id) === String(id));
};

  handleIntent(session, aiRes) {
    const { intent, productId, quantity, text } = aiRes;
    // Если бот что-то нашел, запоминаем это "на всякий случай"
    if (productId) {
      session.lastViewedProductId = productId;
    }
    switch (intent) {
      case 'add_to_cart':
        // Запоминаем, что пользователь ХОЧЕТ добавить, но ждем подтверждения
        const productInfo = this.findProduct(productId);
        session.pendingAction = { type: 'ADD', productId, quantity, name: productInfo.name, price: productInfo.price, quantity: quantity || 1 };
        const isChanged = session.cart.some((item, index, arr)=>{
          if(item.productId==productId){
            item.quantity++;
            item.price*2;
            return true;
          }
        })
        if(!isChanged) 
          session.cart.push(session.pendingAction);
        session.pendingAction = null;
        return { message: text };

      case 'confirm':
        if (session.pendingAction?.type === 'ADD') {
          const item = session.pendingAction;
          const isChanged = session.cart.some((item, index, arr)=>{
            if(item.productId==productId){
              item.quantity++;
              return true;
            }
          })
          if(!isChanged) 
            session.cart.push(item);
          session.pendingAction = null;
          return { message: "✅ Добавлено в расчет! " + text };
        }
        return { message: text };

      case 'cancel':
        session.pendingAction = null;
        return { message: "Хорошо, отменил. " + text };

      case 'view_cart':
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
        
          const report = `🛒 **Ваш текущий расчет:**\n\n${cartLines.join('\n')}\n\n**Итого: ${totalSum} руб.**\n\nСформировать КП в PDF или добавим что-то еще?`;
          
          return { message: report };

      case 'search':
      default:
        return { message: text };
    }
  }

}

//const ai_service = new aiService();

export default aiService
 
