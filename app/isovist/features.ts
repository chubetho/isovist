import type { CheckboxGroupItem } from '@nuxt/ui'
import type { FeatureKey, Features, Point } from './types'
import { centroid, clamp, distPointToPoint, EPS } from './utils'

export const FEATURE_KEYS = [
  'area',
  'perimeter',
  'compactness',
  'occlusivity',
  'drift',
  'radialLengthMin',
  'radialLengthMean',
  'radialLengthMax',
  'radialMomentMean',
  'radialMomentVariance',
  'radialMomentSkewness',
] as const

const cache = {
  moments: new Map<string, { m1: number, m2: number, m3: number }>(),
}

export const features: {
  fns: Record<FeatureKey, (viewpoint: Point, points: Point[]) => number>
  checkboxes: (CheckboxGroupItem & { value: FeatureKey })[]
} = {
  fns: {
    area(_, points) {
      const n = points.length
      if (n < 3) {
        return 0
      }

      let sum = 0
      for (let i = 0; i < n; i++) {
        const cur = points[i]
        const next = i + 1 === n ? points[0] : points[(i + 1)]
        const prev = i === 0 ? points[n - 1] : points[i - 1]
        sum += cur.x * (next.y - prev.y)
      }

      const area = 0.5 * Math.abs(sum)
      return area
    },
    perimeter(_, points) {
      const n = points.length
      if (n < 2) {
        return 0
      }

      let perimeter = 0
      for (let i = 0; i < n; i++) {
        const cur = points[i]
        const next = i + 1 === n ? points[0] : points[(i + 1)]
        perimeter += distPointToPoint(cur, next)
      }

      return perimeter
    },
    compactness(viewpoint, points) {
      const perimeter = features.fns.perimeter(viewpoint, points)
      if (perimeter === 0) {
        return 0
      }

      const area = features.fns.area(viewpoint, points)
      const compactness = (4 * Math.PI * area) / (perimeter ** 2)
      return compactness
    },
    occlusivity() {
      return 0
    },
    drift(viewpoint, points) {
      const area = features.fns.area(viewpoint, points)
      const _centroid = centroid(points, area)
      if (!_centroid)
        return 0

      return distPointToPoint(viewpoint, _centroid)
    },
    radialLengthMin(viewpoint, points) {
      const n = points.length
      if (n === 0)
        return 0

      const lengths = points.map(p => distPointToPoint(viewpoint, p))
      return Math.min(...lengths)
    },
    radialLengthMean(viewpoint, points) {
      const n = points.length
      if (n === 0)
        return 0

      const sum = points.reduce((acc, p) => acc + distPointToPoint(viewpoint, p), 0)
      return sum / n
    },
    radialLengthMax(viewpoint, points) {
      const n = points.length
      if (n === 0)
        return 0

      const lengths = points.map(p => distPointToPoint(viewpoint, p))
      return Math.max(...lengths)
    },
    radialMomentMean(viewpoint, points) {
      const cacheKey = computeCacheKey(viewpoint)
      const _moments = cache.moments.get(cacheKey)
      if (_moments)
        return _moments.m1

      const moments = computedMoments(viewpoint, points)
      if (moments) {
        cache.moments.set(cacheKey, moments)
        return moments.m1
      }
      cache.moments.set(cacheKey, { m1: 0, m2: 0, m3: 0 })
      return 0
    },
    radialMomentVariance(viewpoint, points) {
      const cacheKey = computeCacheKey(viewpoint)
      const _moments = cache.moments.get(cacheKey)
      if (_moments)
        return _moments.m2

      const moments = computedMoments(viewpoint, points)
      if (moments) {
        cache.moments.set(cacheKey, moments)
        return moments.m2
      }
      cache.moments.set(cacheKey, { m1: 0, m2: 0, m3: 0 })
      return 0
    },
    radialMomentSkewness(viewpoint, points) {
      const cacheKey = computeCacheKey(viewpoint)
      const _moments = cache.moments.get(cacheKey)
      if (_moments)
        return _moments.m3

      const moments = computedMoments(viewpoint, points)
      if (moments) {
        cache.moments.set(cacheKey, moments)
        return moments.m3
      }
      cache.moments.set(cacheKey, { m1: 0, m2: 0, m3: 0 })
      return 0
    },
  },

  checkboxes: [
    {
      label: 'Area',
      description: 'The total visible area from the viewpoint.',
      value: 'area',
    },
    {
      label: 'Perimeter',
      description: 'The total length of the isovist boundary.',
      value: 'perimeter',
    },
    {
      label: 'Compactness',
      description: 'A measure of how "circular" the visible area is.',
      value: 'compactness',
    },
    {
      label: 'Occlusivity',
      description: 'The length of the isovist boundary formed by interior obstacles.',
      value: 'occlusivity',
      disabled: true,
    },
    {
      label: 'Drift',
      description: 'Distance from viewpoint to the balance point of the visible area. Lower is more central.',
      value: 'drift',
    },
    {
      label: 'Radial Length Min',
      description: 'Minimum distance from the viewpoint to an isovist vertex.',
      value: 'radialLengthMin',
    },
    {
      label: 'Radial Length Mean',
      description: 'Average distance from the viewpoint to the isovist vertices.',
      value: 'radialLengthMean',
    },
    {
      label: 'Radial Length Max',
      description: 'Maximum distance from the viewpoint to an isovist vertex.',
      value: 'radialLengthMax',
    },
    {
      label: 'Radial Moment Mean',
      description: 'A measure of the average radial extent based on integration over the boundary segments.',
      value: 'radialMomentMean',
    },
    {
      label: 'Radial Moment Variance',
      description: 'How much the visible distance varies in different directions.',
      value: 'radialMomentVariance',
    },
    {
      label: 'Radial Moment Skewness',
      description: 'The asymmetry of the visible distance distribution.',
      value: 'radialMomentSkewness',
    },
  ],
}

export function computeFeatures(viewpoint: Point, points: Point[], keys: FeatureKey[]) {
  const result: Partial<Features> = {}
  for (const k of keys) {
    result[k] = features.fns[k](viewpoint, points)
  }
  return result
}

function computedMoments(viewpoint: Point, points: Point[]) {
  const n = points.length
  if (n < 3) {
    return
  }

  let a1Sum = 0
  let a2Sum = 0
  let a3Sum = 0

  for (let i = 0; i < n; i++) {
    const cur = points[i]
    const next = i + 1 === n ? points[0] : points[(i + 1)]

    const a = distPointToPoint(viewpoint, cur)
    const b = distPointToPoint(viewpoint, next)
    const c = distPointToPoint(cur, next)
    if (a === 0 || b === 0 || c === 0)
      continue

    const { alpha, beta, gamma } = computeAngles({ a, b, c })
    if (Number.isNaN(alpha) || Number.isNaN(beta) || Number.isNaN(gamma)) {
      continue
    }

    const params = { a, b, c, alpha, beta, gamma }

    const _a1 = computeA1(params)
    const _a2 = computeA2(params)
    const _a3 = computeA3(params)

    if (Number.isNaN(_a1) || Number.isNaN(_a2) || Number.isNaN(_a3)) {
      continue
    }

    a1Sum += _a1
    a2Sum += _a2
    a3Sum += _a3
  }

  const a1 = a1Sum / (2 * Math.PI)
  const a2 = a2Sum / (2 * Math.PI)
  const a3 = a3Sum / (2 * Math.PI)

  const m1 = a1
  const m2 = a2 - m1 ** 2
  const m3 = a3 - 3 * m1 * a2 + 2 * m1 ** 3
  return { m1, m2, m3 }
}

function computeAngles({ a, b, c }: { a: number, b: number, c: number }) {
  const cosGamma = (a * a + b * b - c * c) / (2 * a * b)
  const cosAlpha = (b * b + c * c - a * a) / (2 * b * c)
  const cosBeta = (a * a + c * c - b * b) / (2 * a * c)

  const clampedCosGamma = clamp(cosGamma, -1.0, 1.0)
  const clampedCosAlpha = clamp(cosAlpha, -1.0, 1.0)
  const clampedCosBeta = clamp(cosBeta, -1.0, 1.0)

  const gamma = Math.acos(clampedCosGamma)
  const alpha = Math.acos(clampedCosAlpha)
  const beta = Math.acos(clampedCosBeta)

  return { alpha, beta, gamma }
}

interface AiParams {
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
}
function computeA1({ a, b, c, gamma }: AiParams) {
  const _1st = a * b / c

  const _2nd = Math.sin(gamma) / gamma

  const cosGamma = Math.cos(gamma)
  const _3rdNum = (c + a - b * cosGamma) * (c + b - a * cosGamma)
  const _3rdDenom = a * b * Math.sin(gamma) ** 2
  if (_3rdDenom < EPS)
    return Number.NaN
  const _3rd = Math.log(_3rdNum / _3rdDenom)

  return _1st * _2nd * _3rd
}

function computeA2({ a, b, c, alpha, beta, gamma }: AiParams) {
  const _1st = 1 / gamma
  const _2nd = (a * b * Math.sin(gamma) / c) ** 2
  const _3rd = cot(alpha) + cot(beta)

  return _1st * _2nd * _3rd
}

function computeA3({ a, b, c, alpha, beta, gamma }: AiParams) {
  const _1st = 1 / (2 * gamma)
  const _2nd = (a * b * Math.sin(gamma) / c) ** 3

  const cosecAlpha = cosec(alpha)
  const cotAlpha = cot(alpha)
  const cosecBeta = cosec(beta)
  const cotBeta = cot(beta)
  const _3rdLeft = cosecAlpha * cotAlpha + cosecBeta * cotBeta
  const _3rdRight = Math.log((cosecAlpha + cotAlpha) * (cosecBeta + cotBeta))
  const _3rd = _3rdLeft + _3rdRight

  return _1st * _2nd * _3rd
}

function cot(angle: number) {
  const tan = Math.tan(angle)
  return tan < EPS ? Number.NaN : 1 / tan
}

function cosec(angle: number) {
  const sin = Math.sin(angle)
  return sin < EPS ? Number.NaN : 1 / sin
}

function computeCacheKey(viewpoint: Point) {
  return `${viewpoint.x.toFixed(6)},${viewpoint.y.toFixed(6)}`
}
