export function generateHTML(orderData, cart, totalSum) {
  const date = new Date().toLocaleString('ru-RU');
  const itemsHtml = cart.map((item, index) => `
      <tr>
          <td>${index + 1}</td>
          <td>${item.name}</td>
          <td>${item.quantity}</td>
          <td>${item.price} руб.</td>
          <td>${item.price * item.quantity} руб.</td>
      </tr>
  `).join('');

  return `
  <html>
  <head>
      <style>
          body { font-family: Arial, sans-serif; padding: 30px; }
          h1 { color: #2c3e50; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #f2f2f2; }
          .total { text-align: right; margin-top: 20px; font-size: 1.2em; font-weight: bold; }
      </style>
  </head>
  <body>
      <h1>Коммерческое предложение №${orderData.orderId}</h1>
      <p><strong>Дата:</strong> ${date}</p>
      <p><strong>Заказчик:</strong> ${orderData.clientName}</p>
      <p><strong>Контакты:</strong> ${orderData.contact}</p>
      <table>
          <thead>
              <tr>
                  <th>№</th>
                  <th>Наименование</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
              </tr>
          </thead>
          <tbody>
              ${itemsHtml}
          </tbody>
      </table>
      <div class="total">Итого к оплате: ${totalSum} руб.</div>
  </body>
  </html>`;
}