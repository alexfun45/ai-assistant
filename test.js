import 'dotenv/config'
async function testDirect() {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "model": "google/gemma-3-27b-it:free",
      "messages": [{"role": "user", "content": "Привет!"}]
    })
  });
  const data = await response.json();
  console.log("Direct Test Response:", JSON.stringify(data, null, 2));
}

testDirect();