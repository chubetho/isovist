<script setup lang="ts">
import type { FeatureKey, Point } from '~/isovist/types'
import { cosine, euclidean, manhattan } from '~/isovist/diff'
import { computeFeatures, features } from '~/isovist/features'
import { orthogonalGrid, randomGrid } from '~/isovist/grid'
import { map } from '~/isovist/map'
import { useRobot } from '~/isovist/robot'
import { cast, EPS } from '~/isovist/utils'

interface GlobalConfig {
  features: FeatureKey[]
  distance: 'euclidean' | 'manhattan' | 'cosine'
  grid: {
    show: boolean
    type: 'orthogonal' | 'random'
    nums: number
  }
  robot: {
    rays: boolean
  }
}

const obstacles = map.obstacles
const lines = obstacles.flatMap(o => o.type === 'line' ? o.line : o.lines)

const config = useSessionStorage<GlobalConfig>(
  'isovist_config',
  () => ({
    features: [],
    distance: 'euclidean',
    grid: {
      show: true,
      type: 'orthogonal',
      nums: 239,
    },
    robot: {
      rays: false,
    },
  }),
)

function checkAllFeatureKeys() {
  config.value.features = []
  const keys = features.checkboxes.flatMap(c => 'disabled' in c && c.disabled ? [] : [c.value])
  for (const k of keys) {
    config.value.features.push(k)
  }
}

function clearAllFeatureKeys() {
  config.value.features = []
}

const grid = computed(() => {
  const fn = config.value.grid.type === 'orthogonal' ? orthogonalGrid : randomGrid
  return fn({ map: map.config, obstacles, nums: config.value.grid.nums })
})

const db = computed(() => {
  const entries = grid.value.map((viewpoint) => {
    const points = cast(viewpoint, lines)
    const features = computeFeatures(viewpoint, points, config.value.features)
    return { viewpoint, features }
  })

  const keys = Array.from(config.value.features)

  const lim = {} as Record<FeatureKey, { min: number, max: number }>
  for (const k of keys) {
    for (const entry of entries) {
      const features = entry.features
      if (!lim[k]) {
        lim[k] = {
          min: Number.POSITIVE_INFINITY,
          max: Number.NEGATIVE_INFINITY,
        }
      }

      if (!features[k])
        continue

      if (features[k] < lim[k].min) {
        lim[k].min = features[k]
      }

      if (features[k] > lim[k].max) {
        lim[k].max = features[k]
      }
    }
  }

  for (const k of keys) {
    const { min, max } = lim[k]
    const denom = max - min

    for (const entry of entries) {
      const features = entry.features
      if (!features[k])
        continue

      features[k] = Math.abs(denom) < EPS ? 0 : (features[k] - min) / denom
    }
  }

  return { lim, entries }
})

const robot = useRobot({ x: 300, y: 90, speed: 1 })
const topkPoints = shallowRef<Point[]>()
const hover = shallowRef<Point>()

function find(k = 5, step = 5) {
  const viewpoints = []

  if (step) {
    for (let dx = -step; dx <= step; dx += step) {
      for (let dy = -step; dy <= step; dy += step) {
        viewpoints.push({
          x: robot.state.value.x + dx,
          y: robot.state.value.y + dy,
        })
      }
    }
  }
  else {
    viewpoints.push({ x: robot.state.value.x, y: robot.state.value.y })
  }

  const keys = Array.from(config.value.features)

  const distanceFn = (() => {
    switch (config.value.distance) {
      case 'euclidean': return euclidean
      case 'manhattan': return manhattan
      case 'cosine': return cosine
    }
  })()

  const topkSet = new Set<{ viewpoint: Point, d: number }>()
  for (const viewpoint of viewpoints) {
    const points = cast(viewpoint, lines)
    const features = computeFeatures(viewpoint, points, config.value.features)
    if (!features)
      continue

    for (const k of keys) {
      const { min, max } = db.value.lim[k]
      const denom = max - min
      features[k] = Math.abs(denom) < EPS ? 0 : (features[k]! - min) / denom
    }

    const matches: { viewpoint: Point, d: number }[] = []
    for (const entry of db.value.entries) {
      if (!entry.features)
        continue

      const d = distanceFn(features, entry.features)
      matches.push({ viewpoint: entry.viewpoint, d })
    }
    matches.sort((a, b) => a.d - b.d)
    for (const m of matches.slice(0, k)) {
      topkSet.add(m)
    }
  }
  const topk = Array.from(topkSet).sort((a, b) => a.d - b.d).slice(0, k)
  return topk.map(x => x.viewpoint)
}

const canvasEl = useTemplateRef('canvas')

function draw() {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas)
    return

  const style = getComputedStyle(document.documentElement)
  const bgClr = style.getPropertyValue('--background-color-default')
  const warningClr = style.getPropertyValue('--ui-warning')
  const errorClr = style.getPropertyValue('--ui-error')
  const successClr = style.getPropertyValue('--ui-success')
  const infoClr = style.getPropertyValue('--ui-info')
  const textClr = style.getPropertyValue('--ui-text')
  const textMutedClr = style.getPropertyValue('--ui-text-muted')

  // Draw background
  ctx.fillStyle = bgClr
  ctx.fillRect(0, 0, map.config.width, map.config.height)

  // Draw dots
  if (config.value.grid.show) {
    for (const g of grid.value) {
      ctx.fillStyle = textMutedClr
      ctx.beginPath()
      ctx.arc(g.x, g.y, 3, 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  // Draw obstacles
  ctx.strokeStyle = textClr
  ctx.lineWidth = map.config.lineWidth
  obstacles.forEach((o) => {
    if ('border' in o && o.border) {
      ctx.lineWidth = map.config.lineWidth * 1.5
      o.lines.forEach((l) => {
        ctx.beginPath()
        ctx.moveTo(l.x1, l.y1)
        ctx.lineTo(l.x2, l.y2)
        ctx.stroke()
      })
      ctx.lineWidth = map.config.lineWidth
      return
    }

    if (o.type === 'line') {
      ctx.beginPath()
      ctx.moveTo(o.line.x1, o.line.y1)
      ctx.lineTo(o.line.x2, o.line.y2)
      ctx.stroke()
      return
    }

    if (o.fill) {
      ctx.beginPath()
      ctx.moveTo(o.lines[0].x1, o.lines[0].y1)
      o.lines.forEach((l) => {
        ctx.lineTo(l.x2, l.y2)
      })
      ctx.closePath()
      ctx.fillStyle = textClr
      // ctx.fill()
      ctx.stroke()
      return
    }

    o.lines.forEach((l) => {
      ctx.beginPath()
      ctx.moveTo(l.x1, l.y1)
      ctx.lineTo(l.x2, l.y2)
      ctx.stroke()
    })
  })

  // Draw rays
  if (config.value.robot.rays) {
    const points = cast({ x: robot.state.value.x, y: robot.state.value.y }, lines)
    ctx.lineWidth = 1
    ctx.strokeStyle = successClr
    ctx.globalAlpha = 0.5
    points.forEach((p) => {
      ctx.beginPath()
      ctx.moveTo(robot.state.value.x, robot.state.value.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    })
    ctx.globalAlpha = 1.0
  }

  // Draw robot
  ctx.fillStyle = errorClr
  ctx.beginPath()
  ctx.arc(robot.state.value.x, robot.state.value.y, 10, 0, 2 * Math.PI)
  ctx.fill()

  // Draw topk
  if (topkPoints.value) {
    ctx.fillStyle = warningClr
    let i = 0
    for (const k of topkPoints.value) {
      ctx.beginPath()
      ctx.arc(k.x, k.y, 8 - i++, 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  // Draw hover node
  if (hover.value) {
    const points = cast({ x: hover.value.x, y: hover.value.y }, lines)
    ctx.lineWidth = 1
    ctx.strokeStyle = successClr
    ctx.globalAlpha = 0.5
    points.forEach((p) => {
      ctx.beginPath()
      ctx.moveTo(hover.value!.x, hover.value!.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    })
    ctx.globalAlpha = 1.0

    ctx.fillStyle = infoClr
    ctx.beginPath()
    ctx.arc(hover.value.x, hover.value.y, 6, 0, 2 * Math.PI)
    ctx.fill()
  }
}

useEventListener(canvasEl, 'mousemove', useThrottleFn((event: MouseEvent) => {
  const canvas = canvasEl.value!
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const threshold = map.config.lineWidth * 2

  const entry = db.value.entries.find((e) => {
    const nearX = (x - threshold) <= e.viewpoint.x && e.viewpoint.x <= (x + threshold)
    const nearY = (y - threshold) <= e.viewpoint.y && e.viewpoint.y <= (y + threshold)
    return nearX && nearY
  })

  if (!entry)
    return

  hover.value = entry.viewpoint
}))

useEventListener(canvasEl, 'mouseout', () => {
  hover.value = undefined
})

const keys = new Set<string>()

useEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase())
})

useEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase())
})

useEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f') {
    topkPoints.value = find().map(p => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
    }))
  }
})

function input() {
  if (keys.has('w') && robot.state.value.y > 0) {
    robot.down()
  }
  if (keys.has('s') && robot.state.value.y < map.config.height) {
    robot.up()
  }
  if (keys.has('a') && robot.state.value.x > 0) {
    robot.right()
  }
  if (keys.has('d') && robot.state.value.x < map.config.width) {
    robot.left()
  }
}

function animate() {
  draw()
  input()
  requestAnimationFrame(animate)
}
onMounted(animate)
</script>

<template>
  <div class="p-6 mx-auto font-mono @container">
    <div class="grid grid-cols-1 gap-6 @min-[1200px]:grid-cols-2">
      <div class="relative flex flex-col gap-3 items-center justify-center">
        <div class="absolute top-0 right-0 flex gap-2">
          <UButton
            icon="i-lucide-github"
            variant="soft"
            to="https://github.com/chubetho/isovist"
            target="_blank"
          />
          <ColorMode />
        </div>
        <h1 class="text-success font-bold text-xl mt-3 tracking-widest">
          Kidnapped Robot and Isovist
        </h1>
        <canvas
          ref="canvas"
          :width="map.config.width"
          :height="map.config.height"
          class="my-6"
        />
        <UCard>
          <div class="grid gap-1">
            <p>
              <span class="font-extrabold text-success">W/A/S/D</span> to move
            </p>
            <p>
              <span class="font-extrabold text-success">Hover</span> on grid node to show its rays
            </p>
            <p>
              <span class="font-extrabold text-success">F</span> to find grid node
            </p>
          </div>
        </UCard>

        <UCard class="w-full @min-[1200px]:max-w-4/5">
          <div class="grid gap-3">
            <div>
              <span class="font-extrabold">Robot: </span>
              <span class="text-success">
                ({{ robot.state.value.x }},{{ robot.state.value.y }})
              </span>
            </div>

            <div class="flex flex-wrap gap-3 min-h-[2lh]">
              <p class="font-extrabold">
                Found points:
              </p>
              <span
                v-for="f, i of topkPoints"
                :key="i"
              >
                <span class="text-success">{{ i + 1 }}.</span>({{ f.x }},{{ f.y }})
              </span>
            </div>
          </div>
        </UCard>
      </div>

      <div class="grid gap-3">
        <UCard>
          <div class="grid gap-3">
            <div class="flex items-center justify-between">
              <p class="font-extrabold">
                Features
              </p>
              <div class="flex gap-2">
                <UButton
                  size="xs"
                  @click="checkAllFeatureKeys"
                >
                  Check all
                </UButton>
                <UButton
                  size="xs"
                  color="warning"
                  @click="clearAllFeatureKeys"
                >
                  Clear all
                </UButton>
              </div>
            </div>
            <UCheckboxGroup
              v-model="config.features"
              :items="features.checkboxes"
            />
          </div>
        </UCard>

        <UCard>
          <div class="grid gap-3">
            <p class="mb-2 font-extrabold">
              Distances
            </p>
            <URadioGroup
              v-model="config.distance"
              orientation="horizontal"
              :items="[
                { label: 'Euclidean', value: 'euclidean' },
                { label: 'Manhattan', value: 'manhattan' },
                { label: 'Cosine', value: 'cosine' },
              ]"
              :ui="{ fieldset: 'gap-x-10' }"
            />
          </div>
        </UCard>

        <UCard>
          <div class="grid gap-3">
            <p class="font-extrabold">
              Grid
            </p>

            <URadioGroup
              v-model="config.grid.type"
              orientation="horizontal"
              :items="[
                { label: 'Orthogonal', value: 'orthogonal' },
                { label: 'Restricted random', value: 'random' },
              ]"
              :ui="{ fieldset: 'gap-x-10', item: 'items-center' }"
            >
              <template #label="{ item, modelValue }">
                <div
                  v-if="(item as any).value === 'random' && modelValue === 'random'"
                  class="flex items-center gap-2"
                >
                  <span>{{ (item as any).label }} with </span>
                  <UInputNumber
                    v-model="config.grid.nums"
                    size="sm"
                    orientation="vertical"
                    class="w-20"
                  />
                  <span>nodes</span>
                </div>
              </template>
            </URadioGroup>
          </div>
        </UCard>

        <UCard>
          <div class="grid gap-3">
            <p class="font-extrabold">
              Display
            </p>
            <div class="flex gap-10">
              <USwitch
                v-model="config.grid.show"
                label="Grid points"
              />
              <USwitch
                v-model="config.robot.rays"
                label="Robot rays"
              />
            </div>
          </div>
        </UCard>

        <!-- <UCard>
          <div class="grid gap-3">
            <p class="mb-2 font-extrabold">
              Robot
            </p>

            <label>
              <span>Speed: </span>
              <UInputNumber
                v-model="robot.state.value.speed"
                :min="1"
                :step="1"
                orientation="vertical"
                class="w-20"
              />
            </label>
          </div>
        </UCard> -->
      </div>
    </div>
  </div>
</template>
