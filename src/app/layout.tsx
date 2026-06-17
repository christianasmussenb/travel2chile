import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Travel2Chile — Planifica tu viaje a Chile con IA',
  description: 'Asistente virtual especializado en turismo en Chile. Torres del Paine, Atacama, Santiago y más.',
  keywords: 'viajes Chile, turismo, Torres del Paine, San Pedro de Atacama, Santiago',
  openGraph: {
    title: 'Travel2Chile',
    description: 'Planifica tu viaje a Chile con inteligencia artificial',
    url: 'https://travel2chile.com',
    siteName: 'Travel2Chile',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
