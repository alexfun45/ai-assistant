import 'dotenv/config'
import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

export async function getPriceData() {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['Price'];
  const rows = await sheet.getRows();
  
  // Превращаем строки таблицы в текст для ИИ
  const context = rows.map(r => 
    `Арт: ${r.get('Артикул')}, Товар: ${r.get('Наименование')}, Цена: ${r.get('Цена (руб)')}, Описание: ${r.get('Описание для ИИ')}`
  ).join('\n');
  const data = rows.map((r) => { 
    return {
      id: r.get('Артикул'),
      name: r.get('Наименование'),
      category: r.get('Категория'),
      price: r.get('Цена (руб)'),

    }
  }
  )
  return [context, data];
}

export async function saveOrderToSheets(ctx) {
  const session = ctx.session;
  const orderId = `ORD-${Date.now()}`; // Уникальный номер заказа
  const date = new Date().toLocaleString('ru-RU');
  const clientName = session.orderData?.clientName || 'Не указано';
  const clientContact = session.orderData?.contact || 'Не указано';
  // Подключаемся к нужному листу
  await doc.loadInfo(); 
  const sheet = doc.sheetsByTitle['Заказы'];
  //await sheet.addRow({});
  // Формируем массив строк для добавления
  const rows = session.cart.map(item => ({
    'ID заказа': orderId,
    'Дата': date,
    'Клиент': clientName, // Берем из собранных данных
    'Контакты': clientContact, // Добавь этот столбец в таблицу!
    'Артикул': item.id,
    'Название': item.name,
    'Количество': item.quantity,
    'Цена': item.price,
    'Сумма': item.price * item.quantity
  }));


  // Записываем всё пачкой (это быстрее, чем по одной строке)
  await sheet.addRows(rows);
  
  return orderId;
}

export async function getCategories(){
  const sheet = doc.sheetsByTitle['Price'];
  const rows = await sheet.getRows();
  let categories = {};
  for(let row of rows){
    categories[row.get('Категория')] = row.get('Артикул');
  }
  return categories;
}

// получение скидок
export async function getDiscount(){
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['Скидки'];
  const rows = await sheet.getRows();
  return rows.map( r => {
    return {
      target: r.get('Категория / ID'),
      __type: r.get('Тип скидки'),
      value: r.get('Значение'),
      minQty: r.get('Условие (Мин. кол-во)'),
      start: r.get('Дата начала'),
      end: r.get('Дата окончания')
    }
  })
} 