import { expect, test } from '@playwright/test'

test('landing page reaches chat and the chat can send a message', async ({ page }) => {
  await page.route('**/api/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [], conversationId: null }),
    })
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: /Planifica tu viaje a Chile/i })).toBeVisible()
  await page.getByRole('link', { name: /Comenzar ahora/i }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByText('Sugerencias — ¿qué quieres saber?')).toBeVisible()
  await expect(page.getByPlaceholder('¿Cuándo ir a Patagonia? ¿Cuánto cuesta Atacama?...')).toBeVisible()
})

test('chat suggestions send a message and render the streamed answer', async ({ page }) => {
  await page.route('**/api/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [], conversationId: null }),
    })
  })

  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"text":"Hola desde Playwright"}\n\ndata: [DONE]\n\n',
    })
  })

  await page.goto('/chat')

  await page.getByRole('button', { name: /¿Cuándo ir a Torres del Paine\?/i }).click()
  await expect(page.getByText('Hola desde Playwright')).toBeVisible()

  await page.getByRole('button', { name: /Nueva conversación/i }).click()
  await expect(page.getByText('Sugerencias — ¿qué quieres saber?')).toBeVisible()
  await expect(page.getByText('Hola desde Playwright')).toHaveCount(0)
})

test('chat renders a provider error message from SSE', async ({ page }) => {
  await page.route('**/api/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [], conversationId: null }),
    })
  })

  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"error","code":"provider_timeout","message":"OpenRouter tardó demasiado en responder. Intenta nuevamente.","retryable":true}\n\ndata: [DONE]\n\n',
    })
  })

  await page.goto('/chat')

  await page.getByRole('button', { name: /Mejor época para Atacama/i }).click()
  await expect(page.getByText('OpenRouter tardó demasiado en responder. Intenta nuevamente.')).toBeVisible()
})
