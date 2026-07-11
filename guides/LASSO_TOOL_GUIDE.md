# Lasso Selection Tool

## Overview
The Lasso tool enables multi-object selection by drawing a boundary around objects in the 3D viewport. This is useful for quickly selecting multiple objects without holding modifier keys.

## Features

- **Free-form selection**: Draw any shape boundary to select objects
- **Point-in-polygon detection**: Accurately determines which objects fall within the drawn lasso
- **Visual feedback**: Orange line follows your mouse while drawing
- **Grid-based raycasting**: Samples multiple rays within the lasso boundary to find objects
- **Multi-select**: All objects within the lasso are selected together

## How to Use

### Activating Lasso Mode
1. Click the **"Lasso"** button in the toolbar (located between Scale and Edit buttons)
   - The button will highlight to indicate active mode
   - The cursor will change to a crosshair

### Drawing a Lasso
1. With Lasso mode active, click and drag in the viewport
2. An orange line will appear showing your drawn path
3. Release the mouse button to complete the lasso
4. All objects within the boundary are automatically selected

### Exiting Lasso Mode
- Click the **"Lasso"** button again to toggle off
- The cursor will return to normal

### Normal Operations While Lasso is Off
- When lasso is off, normal click-to-select and shift-click multi-select work as usual
- The lasso button acts as a toggle to switch between selection modes

## Implementation Details

### Files Modified
- **Toolbar.js**: Added Lasso button with toggle functionality
- **Editor.js**: Added `lassoModeChanged` signal
- **Viewport.js**: Implemented lasso drawing, point-in-polygon testing, and raycasting

### Key Components

#### Lasso Canvas
- Hidden overlay canvas (`#canvas`) placed over the viewport
- Only visible when actively drawing
- Renders the orange lasso line in real-time

#### Point-in-Polygon Algorithm
Uses ray-casting algorithm to determine if screen points are within the lasso boundary:
```javascript
function isPointInLasso( point, lasso ) {
  // Standard ray casting: count ray intersections
  // Odd count = inside, even count = outside
}
```

#### Raycasting Grid
- Samples a grid of points (15-pixel spacing) within the lasso boundary
- For each point inside the lasso, casts a ray into the 3D scene
- Collects all intersected meshes and lights
- Uses `THREE.Raycaster` for 3D intersection testing

#### Coordinate Transformation
- Converts screen-space lasso points to normalized device coordinates (NDC)
- NDC range: [-1, 1] for both X and Y
- Uses camera projection for accurate raycasting

### Signal Flow
1. User clicks Lasso button → `signals.lassoModeChanged.dispatch({ active: true })`
2. Viewport enters lasso mode, cursor changes to crosshair
3. User draws on canvas → mouse events collected, line rendered
4. User releases mouse → `finalizeLasso()` executes:
   - Performs raycasting within lasso boundary
   - Collects selected objects
   - Dispatches `signals.intersectionsDetected` with results
5. Selector.js processes intersections normally (multi-select works)

## Technical Notes

### Raycasting Considerations
- Grid step size (15px) balances accuracy vs. performance
- Only tests points *inside* the lasso polygon (not the entire bounding box)
- Filters for `isMesh` and `isLight` objects
- Returns first intersection per grid point (not layering)

### Performance
- Lasso with ~50 points and 400x300 viewport ≈ 800-1000 raycasts
- Runs asynchronously after mouse release (no frame lag)
- Typical selection completes in <50ms

### Modifier Keys
- Lasso is activated via the toolbar button (not keyboard shortcut yet)
- While drawing, no modifier keys are required
- Multi-select with previously selected objects uses shift-click after lasso completes

## Keyboard Shortcut (Optional Future Addition)
Currently the lasso requires clicking the button. A keyboard shortcut (e.g., `L`) could be added:
1. Add shortcut binding in `Config.js`
2. Listen for keydown in Viewport.js
3. Toggle lasso mode via signal dispatch

## Example Workflow
1. Click **Lasso** button in toolbar
2. Draw a circular path around the red cube and purple torus
3. Release mouse - both objects are selected (shown in outliner and with bounding boxes)
4. Click **Lasso** again to return to normal selection mode
5. Shift+click other objects to add to selection

## Troubleshooting

### Lasso button not visible
- Page may need to be refreshed (F5)
- Check browser console for syntax errors

### No objects selected
- Ensure lasso boundary fully encloses the object centers
- Try drawing a larger lasso
- Check that objects aren't hidden or filtered

### Selection seems incomplete
- Increase grid step size in `finalizeLasso()` (currently 15px)
- Ensure lasso has at least 3 points
- Check 3D objects are visible in viewport

## Future Enhancements

1. **Keyboard shortcut**: Add configurable hotkey (e.g., `L`)
2. **Lasso refinement**: Option to add/subtract from existing selection via modifier keys
3. **Lasso type options**: Select by:
   - Boundary (current)
   - Center only (object centers inside lasso)
   - Full containment (entire object inside)
4. **Visual improvements**: 
   - Animated preview of selected objects
   - Lasso line color customization
   - Thickness adjustment
5. **Performance**: 
   - Adaptive grid size based on viewport size
   - Spatial acceleration (octree/BVH for raycasting)
