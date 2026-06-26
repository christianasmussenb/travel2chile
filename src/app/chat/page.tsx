import ChatInterface from '@/components/ChatInterface'
import { getPublicAIStatusLabel } from '@/lib/ai'

export const metadata = {
  title: 'Travel2Chile — Chat con IA',
  description: 'Planifica tu viaje a Chile con inteligencia artificial',
}

export default function ChatPage() {
  return <ChatInterface aiStatusLabel={getPublicAIStatusLabel()} />
}
