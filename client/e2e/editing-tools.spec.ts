import { expect, test } from '@playwright/test'

test.use({ browserName: 'firefox' })

test('polygon editing tools enforce geometry and update cursor by advanced mode', async ({ page, request }) => {
  test.setTimeout(120_000)

  const uid = Date.now()
  const username = `edit_${uid}`
  const email = `${username}@example.com`
  const password = 'password123'
  const layerName = `Cursor Layer ${uid}`

  await page.goto('/')
  test.skip(
    await page.getByText('Map preview unavailable in this environment (WebGL required).').isVisible(),
    'WebGL is required for map-editing cursor tests',
  )
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password (min 8 chars)').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('button', { name: 'New Layer' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'New Layer' }).click()
  await page.getByLabel('Layer name').fill(layerName)
  await page.getByRole('combobox', { name: 'Geometry type' }).click()
  await page.getByRole('option', { name: 'Polygon', exact: true }).click()
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.locator('nav').getByText(layerName, { exact: true }).first()).toBeVisible()

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
  const layer = layers.find((item) => item.name === layerName)
  expect(layer).toBeTruthy()
  const layerId = layer?.id as string

  await page.getByRole('button', { name: `Edit ${layerName}` }).click()

  await expect(page.getByRole('heading', { name: 'Editing Workbench' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Point tool/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Line tool/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Polygon tool/i })).toHaveCount(1)

  const canvas = page.locator('.maplibregl-canvas').first()
  await page.getByRole('button', { name: /Polygon tool/i }).first().click()
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  if (!box) {
    return
  }

  const p1 = { x: Math.floor(box.x + box.width * 0.35), y: Math.floor(box.y + box.height * 0.35) }
  const p2 = { x: Math.floor(box.x + box.width * 0.5), y: Math.floor(box.y + box.height * 0.35) }
  const p3 = { x: Math.floor(box.x + box.width * 0.5), y: Math.floor(box.y + box.height * 0.52) }
  const p4 = { x: Math.floor(box.x + box.width * 0.35), y: Math.floor(box.y + box.height * 0.52) }

  await page.mouse.click(p1.x, p1.y)
  await page.mouse.click(p2.x, p2.y)
  await page.mouse.click(p3.x, p3.y)
  await page.mouse.dblclick(p4.x, p4.y)

  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/layers/${layerId}/features`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok()) {
        return 0
      }
      const collection = (await response.json()) as { features: unknown[] }
      return collection.features.length
    })
    .toBeGreaterThan(0)

  // Switching from drawing to an advanced tool restores simple-select after
  // the persisted feature refresh replaces the temporary draw feature.
  const rotateScaleButton = page.getByRole('button', { name: 'Rotate / Scale', exact: true }).first()
  await rotateScaleButton.scrollIntoViewIfNeeded()
  await rotateScaleButton.focus()
  await rotateScaleButton.press('Enter')
  await expect(page.getByLabel('Rotate (°)')).toBeVisible()

  const centerX = Math.floor((p1.x + p3.x) / 2)
  const centerY = Math.floor((p1.y + p3.y) / 2)
  const readSelectedCount = () =>
    page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('div, span, p')).map((node) => node.textContent?.trim() ?? '')
      const selectedText = texts.find((text) => /^[0-9]+ selected$/.test(text))
      if (!selectedText) {
        return 0
      }
      return Number.parseInt(selectedText.split(' ')[0] ?? '0', 10)
    })

  const selectionClicks = [
    { x: centerX, y: centerY },
    p1,
    p2,
    p3,
    p4,
  ]

  let selectedCount = 0
  for (const point of selectionClicks) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(200)
    selectedCount = await readSelectedCount()
    if (selectedCount > 0) {
      break
    }
  }

  expect(selectedCount).toBeGreaterThan(0)
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvasEl = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement | null
        return canvasEl ? getComputedStyle(canvasEl).cursor : ''
      }),
    )
    .toBe('move')

  const featuresBeforeResp = await request.get(`/api/v1/layers/${layerId}/features`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(featuresBeforeResp.ok()).toBeTruthy()
  const featuresBefore = (await featuresBeforeResp.json()) as { features: Array<{ geometry: unknown }> }
  expect(featuresBefore.features.length).toBeGreaterThan(0)
  const geometryBefore = JSON.stringify(featuresBefore.features[0]?.geometry ?? null)

  const expectCursorForTool = async (toolName: string, expectedCursor: string) => {
    const toolButton = page.getByRole('button', { name: toolName, exact: true }).first()
    await toolButton.focus()
    await toolButton.press('Enter')

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const canvasEl = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement | null
          return canvasEl ? getComputedStyle(canvasEl).cursor : ''
        }),
      )
      .toBe(expectedCursor)

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const texts = Array.from(document.querySelectorAll('div, span, p')).map((node) => node.textContent?.trim() ?? '')
          return texts.find((text) => text.startsWith('Cursor:')) ?? ''
        }),
      )
      .toContain(`Cursor: ${expectedCursor}`)
  }

  const handleStart = {
    x: Math.floor((p1.x + p2.x) / 2),
    y: Math.floor(Math.min(p1.y, p2.y) - 34),
  }
  await page.mouse.move(handleStart.x, handleStart.y)
  await page.mouse.down()
  await page.mouse.move(handleStart.x + 70, handleStart.y + 40, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(350)

  const featuresAfterResp = await request.get(`/api/v1/layers/${layerId}/features`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(featuresAfterResp.ok()).toBeTruthy()
  const featuresAfter = (await featuresAfterResp.json()) as { features: Array<{ geometry: unknown }> }
  expect(featuresAfter.features.length).toBeGreaterThan(0)
  const geometryAfter = JSON.stringify(featuresAfter.features[0]?.geometry ?? null)
  expect(geometryAfter).not.toBe(geometryBefore)

  let selectedAfterRotate = 0
  for (const point of selectionClicks) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(200)
    selectedAfterRotate = await readSelectedCount()
    if (selectedAfterRotate > 0) {
      break
    }
  }
  expect(selectedAfterRotate).toBeGreaterThan(0)

  await expectCursorForTool('Trace', 'alias')
  await expectCursorForTool('Split', 'crosshair')
})
