import axios from 'axios'

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

export async function sendTelegramAlert(message: string): Promise<void> {
  if (!TOKEN || !CHAT_ID) return

  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id:    CHAT_ID,
      text:       message,
      parse_mode: 'HTML',
    })
  } catch {
    // Silencioso — alerta não é crítico
  }
}

export function formatAlert(
  type: 'win' | 'loss' | 'opportunity' | 'risk',
  data: Record<string, string | number>
): string {
  const icons = { win: '✅', loss: '❌', opportunity: '📊', risk: '⚠️' }
  const icon  = icons[type]
  const lines = Object.entries(data).map(([k, v]) => `  <b>${k}</b>: ${v}`)
  return `${icon} <b>${type.toUpperCase()}</b>\n${lines.join('\n')}`
}
