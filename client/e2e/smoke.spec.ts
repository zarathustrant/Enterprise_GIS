import { expect, test } from '@playwright/test'

test('auth + layer + feature smoke flow', async ({ page, request }) => {
  const uid = Date.now()
  const username = `smoke_${uid}`
  const email = `${username}@example.com`
  const password = 'password123'

  await page.goto('/')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password (min 8 chars)').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('button', { name: 'New Layer' })).toBeVisible()

  await page.getByRole('button', { name: 'New Layer' }).click()
  await page.getByLabel('Layer name').fill('Smoke Layer')
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByText('Smoke Layer', { exact: true })).toBeVisible()

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('enterprise-gis-auth')
    if (!raw) {
      return null
    }
    return JSON.parse(raw).state.token as string | null
  })

  expect(token).toBeTruthy()

  const layersResp = await request.get('/api/v1/layers', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(layersResp.ok()).toBeTruthy()

  const layers = (await layersResp.json()) as Array<{ id: string; name: string }>
  const layer = layers.find((item) => item.name === 'Smoke Layer')
  expect(layer).toBeTruthy()

  const createFeatureResp = await request.post(`/api/v1/layers/${layer?.id}/features`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      geometry: {
        type: 'Point',
        coordinates: [5.6, 6.3],
      },
      properties: {
        name: 'Smoke point',
      },
    },
  })

  expect(createFeatureResp.ok()).toBeTruthy()

  const featuresResp = await request.get(`/api/v1/layers/${layer?.id}/features`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  expect(featuresResp.ok()).toBeTruthy()
  const collection = (await featuresResp.json()) as { features: unknown[] }
  expect(collection.features.length).toBeGreaterThan(0)
})
