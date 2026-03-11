# Split Mode - Complete Fix Summary

## 🎯 Issues Reported

**Issue 1**: "You can't see the line as it's being drawn - only the first point shows"
**Issue 2**: "Split doesn't follow the drawn line - it splits however it wants"

## ✅ Issue 1: FIXED - Line Visibility

### Root Cause
MapboxDraw was initialized without custom styles, relying on default CSS which may have been overridden or had z-index issues with deck.gl overlay.

### Solution Implemented
Added explicit, highly visible custom styles for MapboxDraw at initialization:

**Location**: [MapCanvas.tsx:4123-4229](client/src/components/MapCanvas.tsx#L4123-L4229)

```typescript
drawRef.current = new DrawCtor({
  displayControlsDefault: false,
  controls: drawControlsForGeometryFamily(activeEditGeometryFamily),
  defaultMode: 'simple_select',
  styles: [
    // Active line being drawn - bright orange, thick, highly visible
    {
      id: 'gl-draw-line-active',
      type: 'line',
      filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FF6B35',  // Bright orange
        'line-width': 4,           // Thick line
      },
    },
    // Vertices - large dots with white stroke
    {
      id: 'gl-draw-polygon-and-line-vertex-active',
      type: 'circle',
      filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
      paint: {
        'circle-radius': 7,
        'circle-color': '#FF6B35',
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    },
    // ... more styles for polygons, points, etc.
  ],
})
```

### What Works Now
✅ **Bright orange line** (#FF6B35, 4px wide) appears immediately when you click the first point
✅ **Line stretches** from last point to cursor as you move the mouse
✅ **Large vertex dots** (7px radius) with white stroke mark each clicked point
✅ **Midpoint dots** (4px, amber) appear between vertices for adding points
✅ **Visual feedback** is instant and highly visible

---

## ⚠️ Issue 2: PARTIALLY FIXED - Split Algorithm

### What Was Done

#### Step 1: Capture Split Line Geometry ✅
**Location**: [MapCanvas.tsx:2135](client/src/components/MapCanvas.tsx#L2135)

Added ref to store the split line:
```typescript
const splitLineGeometryRef = useRef<Geometry | null>(null)
```

#### Step 2: Store Before Deleting ✅
**Location**: [MapCanvas.tsx:3590-3613](client/src/components/MapCanvas.tsx#L3590-L3613)

Modified onCreate handler to capture split line geometry:
```typescript
const splitLineFeature = event.features.find((feature) => isLineGeometryType(feature.geometry.type))
if (splitLineFeature) {
  // Store the split line geometry before deleting it
  splitLineGeometryRef.current = cloneGeometry(splitLineFeature.geometry)

  // ... delete the sketch, run split

  splitLineGeometryRef.current = null // Clear after use
}
```

#### Step 3: Pass to Split Function ✅
**Location**: [MapCanvas.tsx:2508-2511](client/src/components/MapCanvas.tsx#L2508-L2511)

```typescript
const splitLine = splitLineGeometryRef.current
const splitGeometries = splitLine
  ? splitGeometryByLine(feature.geometry, splitLine)
  : splitGeometryByFamily(feature.geometry)
```

#### Step 4: Placeholder Implementation ✅
**Location**: [MapCanvas.tsx:1968-2005](client/src/components/MapCanvas.tsx#L1968-L2005)

Created `splitGeometryByLine()` function that:
- ✅ Validates the split line
- ✅ Extracts line coordinates
- ✅ Logs what it's attempting to do
- ✅ **Falls back to midpoint split** (same as before)
- ✅ **Logs warnings** explaining what's missing

### Console Output
When you draw a split line, you'll see:
```
[Split] Attempting to split Polygon with line of 3 points
[Split] Line-based splitting not yet implemented - using fallback midpoint split
[Split] To fix: Install @turf/turf and implement geometric intersection logic
```

### What Still Needs Work ❌

The **actual geometric splitting algorithm** is NOT yet implemented. Currently it still:
- ❌ Splits polygons at vertical center (ignores your line)
- ❌ Splits lines at midpoint (ignores your line)

### Why Not Fully Implemented?

Line-based splitting requires complex geometric operations:
1. **Find intersection points** between split line and feature boundary
2. **Cut geometry** at those exact points
3. **Group segments** into separate geometries
4. Handle **edge cases**: line doesn't intersect, line only touches edge, multiple crossings, etc.

This requires either:
- **Option A**: Install `@turf/turf` library (~200KB) and use `turf.lineSplit()` / `turf.polygonCut()`
- **Option B**: Implement custom polygon cutting algorithm (~500+ lines of complex math)

---

## 📊 Summary: What Works vs What Doesn't

| Feature | Status | Details |
|---------|--------|---------|
| **See line while drawing** | ✅ **FIXED** | Bright orange, 4px wide, highly visible |
| **See vertices** | ✅ **FIXED** | Large dots with white stroke |
| **Line drawing controls** | ✅ **FIXED** | Enabled for polygon layers |
| **Split line is captured** | ✅ **FIXED** | Stored before deletion |
| **Split uses captured line** | ⚠️ **PARTIALLY** | Passed to function but not used yet |
| **Split follows your line** | ❌ **NOT YET** | Still uses midpoint/vertical center |

---

## 🎨 Visual Improvements

### Draw Styles Added
- **Active line**: Orange (#FF6B35), 4px width, round caps
- **Vertices**: 7px circles, orange fill, white 2px stroke
- **Midpoints**: 4px circles, amber (#fbb03b)
- **Inactive lines**: Blue (#3388ff), 2px width
- **Polygons (active)**: Amber stroke, 10% fill opacity
- **Polygons (inactive)**: Blue stroke, 10% fill opacity
- **Points**: 5px (inactive) / 7px (active) circles

### Z-Index / Layer Order
MapboxDraw layers render **above** the basemap but **below** deck.gl overlay (due to `interleaved: true`). The custom styles ensure high contrast and visibility.

---

## 🚀 Next Steps

### Option 1: Quick Fix with Turf.js (Recommended)

**Install Turf.js**:
```bash
cd client
npm install @turf/turf
```

**Implement in splitGeometryByLine()** (replace lines 2001-2004):
```typescript
import * as turf from '@turf/turf'

function splitGeometryByLine(geometry: Geometry, splitLine: Geometry): Geometry[] | null {
  // ... validation code stays same ...

  try {
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      const line = turf.lineString(lineCoords)
      const feature = turf.feature(geometry)
      const split = turf.lineSplit(feature, line)

      if (split.features.length >= 2) {
        return split.features.map(f => f.geometry)
      }
    }

    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      // For polygons, use turf.polygonCut or martinez-polygon-clipping
      // This is more complex - may need additional library
      const polygon = turf.polygon(geometry.coordinates)
      const line = turf.lineString(lineCoords)

      // Check for intersections
      const intersections = turf.lineIntersect(line, polygon)

      if (intersections.features.length >= 2) {
        // TODO: Implement polygon cutting logic
        // For now, use a simpler approach or install polygon-clipping library
      }
    }
  } catch (error) {
    console.error('[Split] Error during split:', error)
  }

  // Fallback
  return splitGeometryByFamily(geometry)
}
```

**Effort**: 2-4 hours
**Result**: Proper line-based splitting for LineStrings, partial for Polygons

### Option 2: Full Polygon Splitting

Install additional library for polygon operations:
```bash
npm install polygon-clipping
```

Implement complete polygon cutting algorithm using line intersections.

**Effort**: 1-2 days
**Result**: Full line-based splitting for all geometry types

### Option 3: Accept Current State

Document that split uses midpoint/vertical center, update UI instructions:
```typescript
<Typography variant="caption">
  Note: Split currently uses vertical center. Custom split lines coming soon!
</Typography>
```

**Effort**: 5 minutes
**Result**: User expectations managed, feature still usable

---

## 🧪 Testing the Fixes

### Test Case 1: Line Visibility

1. Open a polygon layer in edit mode
2. Select split mode
3. Select a polygon feature
4. Click on map to start drawing split line
5. **VERIFY**: ✅ Orange line appears immediately
6. Move mouse
7. **VERIFY**: ✅ Line stretches from last point to cursor
8. Click second point
9. **VERIFY**: ✅ Large orange dot with white stroke appears
10. Double-click to finish
11. **VERIFY**: ✅ Line disappears, split executes

**Status**: ✅ **PASS** (all visual feedback working)

### Test Case 2: Split Behavior

1. Continue from Test Case 1
2. Open browser console (F12)
3. **VERIFY**: ✅ See log: `[Split] Attempting to split Polygon with line of N points`
4. **VERIFY**: ✅ See warning: `[Split] Line-based splitting not yet implemented`
5. Check split result
6. **VERIFY**: ⚠️ Feature split at vertical center (not along your line)

**Status**: ⚠️ **PARTIAL** (captures line but doesn't use it)

---

## 📝 Files Modified

### client/src/components/MapCanvas.tsx
- **Line 2135**: Added `splitLineGeometryRef`
- **Lines 3590-3613**: Capture split line in onCreate handler
- **Lines 2508-2511**: Pass split line to split function
- **Lines 1968-2005**: Added `splitGeometryByLine()` placeholder
- **Lines 4123-4229**: Added custom MapboxDraw styles

**Total Changes**: ~150 lines added/modified

---

## 🎉 User Experience Improvements

### Before
1. Enter split mode → No visual feedback
2. Select polygon → Cursor changes only
3. Try to draw line → Can only place points
4. Figure out nothing works → Frustration
5. Give up

### After (Current)
1. Enter split mode → Orange badge + instruction banner
2. Select polygon → Banner updates with detailed instructions
3. Draw line → **Bright orange line with vertex dots**
4. Finish line → Split executes (at midpoint, but with console feedback)
5. Check console → Clear explanation of limitation

### After (With Turf.js)
1. Enter split mode → Orange badge + instruction banner
2. Select polygon → Banner updates
3. Draw line → **Bright orange line with vertex dots**
4. Finish line → **Split follows your exact line! ✨**
5. Done → Perfect result

---

## 🔧 Technical Details

### MapboxDraw Style System

MapboxDraw uses Mapbox GL style specification. Filters target:
- `$type`: Geometry type (LineString, Polygon, Point)
- `active`: Whether feature is currently being edited
- `meta`: Feature metadata (vertex, midpoint, feature)
- `mode`: Draw mode (static, simple_select, etc.)

Our styles prioritize visibility:
- High contrast colors (orange vs blue)
- Thick lines (4px vs default 2px)
- Large vertices (7px vs default 3-4px)
- White strokes for definition

### Geometry Capture Flow

```
User finishes drawing line
   ↓
draw.create event fires
   ↓
onCreate handler receives event.features
   ↓
Find LineString feature
   ↓
Clone & store in splitLineGeometryRef
   ↓
Delete from map (for clean UX)
   ↓
Call runModeCommand('split')
   ↓
Split function reads splitLineGeometryRef
   ↓
Clear splitLineGeometryRef
```

### Why Fall Back to Midpoint?

Without turf.js, implementing line-polygon intersection requires:
1. **Ray casting** to find entry/exit points
2. **Edge traversal** along polygon boundary
3. **Segment grouping** to form new polygons
4. **Winding order** preservation
5. **Hole handling** for polygons with holes
6. **Multi-geometry** support
7. **Edge case** handling (tangent lines, etc.)

This is 500+ lines of complex geometry code that's error-prone and already solved by turf.js.

---

## 💡 Recommendation

**Install turf.js and implement proper splitting** (Option 1)

**Why**:
- Small bundle size impact (~200KB, tree-shakeable)
- Battle-tested library (used by Mapbox, Uber, etc.)
- Handles edge cases correctly
- 2-4 hour implementation vs 1-2 weeks custom code
- Enables other spatial operations (buffer, union, etc.)

**Alternative**:
Document current limitation clearly in UI and plan for future enhancement.

---

**Status**: Line visibility ✅ FIXED | Split algorithm ⚠️ FOUNDATION READY (needs turf.js)
**Date**: March 8, 2026
**Author**: Claude (Anthropic)
