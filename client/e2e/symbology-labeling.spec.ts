import { expect, test } from '@playwright/test'

test.use({ browserName: 'firefox' })

test('seeded symbology, legends, geometry controls, and validation remain coherent', async ({ page, request }) => {
  const browserErrors: string[] = []
  const failedResources: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByLabel('Username').fill('capability_demo')
  await page.getByLabel('Password').fill('EnterpriseGIS!2026')
  await page.getByRole('button', { name: 'Login', exact: true }).click()

  await expect(page.getByLabel('Active map')).toContainText('Symbology & Labels QA', { timeout: 15_000 })
  await expect(page.getByText('Capability Points - Facilities', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Capability Lines - Roads', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Capability Polygons - Districts', { exact: true }).first()).toBeVisible()

  await expect(page.getByText('Legend', { exact: true })).toBeVisible()
  await expect(page.getByText('All other values', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Null / empty', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Style Capability Points - Facilities' }).click()
  await expect(page.getByRole('dialog', { name: 'Layer Style' })).toContainText('Geometry: point')
  await expect(page.getByText('Polygon Fill Patterns', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Style Capability Polygons - Districts' }).click()
  const polygonDialog = page.getByRole('dialog', { name: 'Layer Style' })
  await expect(polygonDialog).toContainText('Geometry: polygon')
  await expect(polygonDialog.getByText('Polygon Fill Patterns', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('enterprise-gis-auth')
    return raw ? JSON.parse(raw).state.token as string : null
  })
  expect(token).toBeTruthy()
  const layersResponse = await request.get('/api/v1/layers', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(layersResponse.ok()).toBeTruthy()
  const layers = await layersResponse.json() as Array<{ id: string; name: string }>
  const districts = layers.find((layer) => layer.name === 'Capability Polygons - Districts')
  expect(districts).toBeTruthy()

  const rejected = await request.put(`/api/v1/layers/${districts?.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      style: {
        rendererType: 'classBreaks',
        classBreakStops: [
          { min: 0, max: 10, color: '#00aa55' },
          { min: 5, max: 20, color: 'not-a-color' },
        ],
      },
    },
  })
  expect(rejected.status()).toBe(400)
  const rejectedBody = await rejected.json() as { details?: string[] }
  expect(rejectedBody.details?.some((detail) => detail.includes('overlaps'))).toBeTruthy()
  expect(rejectedBody.details?.some((detail) => detail.includes('hex color'))).toBeTruthy()

  expect(failedResources.filter((entry) => !entry.includes(`/layers/${districts?.id}`))).toEqual([])
  expect(browserErrors).toEqual([])
})
