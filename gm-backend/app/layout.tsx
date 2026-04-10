export const metadata = { title: 'AgentWorld GM' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body style={{ margin: 0, fontFamily: '-apple-system, sans-serif', background: '#f5f7fa', color: '#1a2a3a' }}>
        {children}
      </body>
    </html>
  )
}
