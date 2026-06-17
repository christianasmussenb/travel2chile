import Link from 'next/link'

const DESTINOS = [
  { nombre: 'Torres del Paine', emoji: '🏔️', desc: 'Patagonia chilena' },
  { nombre: 'San Pedro de Atacama', emoji: '🌵', desc: 'Desierto del norte' },
  { nombre: 'Santiago', emoji: '🏙️', desc: 'Capital vibrante' },
  { nombre: 'Isla de Pascua', emoji: '🗿', desc: 'Moáis y cultura Rapa Nui' },
  { nombre: 'Chiloé', emoji: '🌧️', desc: 'Palafitos y mitología' },
  { nombre: 'Carretera Austral', emoji: '🛣️', desc: 'Aventura sin igual' },
]

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: '#111', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>

      {/* Hero */}
      <div style={{
        position: 'relative',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: "url('/chile_bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}>
        {/* Overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.65)',
        }} />
        {/* Content */}
        <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', padding: '0 1.5rem', maxWidth: '700px' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🇨🇱</div>
          <h1 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '1rem', lineHeight: 1.2, color: '#fff' }}>
            Planifica tu viaje<br />a Chile
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#ddd', marginBottom: '2rem' }}>
            Asistente con IA especializado en turismo chileno.<br />Sin registro, sin costo.
          </p>
          <Link href="/chat" style={{
            display: 'inline-block',
            background: '#2563eb',
            color: '#fff',
            fontWeight: 700,
            fontSize: '1.1rem',
            padding: '1rem 2.5rem',
            borderRadius: '1rem',
            textDecoration: 'none',
          }}>
            Comenzar ahora →
          </Link>
          <p style={{ marginTop: '1rem', color: '#aaa', fontSize: '0.9rem' }}>
            Sin registro · Gratis · Respuestas instantáneas
          </p>
        </div>
      </div>

      {/* Destinos */}
      <div style={{ background: '#1f2937', padding: '4rem 1.5rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem' }}>
            Descubre Chile
          </h2>
          <p style={{ color: '#9ca3af', textAlign: 'center', marginBottom: '2.5rem' }}>
            Pregúntame sobre cualquiera de estos destinos
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
            {DESTINOS.map((d) => (
              <Link key={d.nombre} href="/chat" style={{
                background: '#374151', borderRadius: '0.75rem', padding: '1.5rem',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', textDecoration: 'none', color: '#fff',
              }}>
                <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>{d.emoji}</span>
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{d.nombre}</span>
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.25rem' }}>{d.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: '#1d4ed8', padding: '3rem 1.5rem', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>¿Listo para planificar?</h3>
        <p style={{ color: '#bfdbfe', marginBottom: '1.5rem' }}>Pregunta sobre visas, costos, rutas, temporadas y más</p>
        <Link href="/chat" style={{
          display: 'inline-block', background: '#fff', color: '#1d4ed8',
          fontWeight: 700, padding: '0.75rem 2rem', borderRadius: '0.75rem', textDecoration: 'none',
        }}>
          Hablar con la IA →
        </Link>
      </div>

      {/* Footer */}
      <div style={{ background: '#111', padding: '1.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem', borderTop: '1px solid #222' }}>
        <a href="https://www.casmuss.com/contact" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280' }}>
          Health Technology Consulting © 2026
        </a>
      </div>
    </main>
  )
}
