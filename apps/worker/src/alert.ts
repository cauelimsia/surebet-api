export async function sendTelegramAlert(
  message: string,
  botToken?: string,
  chatId?: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!botToken || !chatId) return;
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch (readErr) {
        body = `<falha ao ler corpo da resposta: ${String(readErr)}>`;
      }
      console.error(JSON.stringify({
        level: 'error', msg: 'telegram respondeu com status não-ok',
        status: res.status, body,
      }));
    }
  } catch (err) {
    // alerta nunca derruba o worker, mas a falha fica registrada
    console.error(JSON.stringify({ level: 'error', msg: 'falha ao enviar alerta telegram', err: String(err) }));
  }
}
