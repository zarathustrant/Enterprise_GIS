# Frontend Map Editing And Workspace Model

## Editing model

The frontend map experience is centered on [MapCanvas.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/MapCanvas.tsx).

This component handles:

- base map and overlay rendering
- feature selection and highlighting
- draw/edit interactions
- measurement overlays
- advanced edit modes
- utility overlays
- map viewport commands

## Work mode

Work mode exists to improve usability during editing-heavy sessions.

Behavior:

- keeps the map visible while tools stay accessible
- converts certain dialogs into docked right-side panels
- reduces modal interruption during editing and inspection workflows

Primary implementation:

- [client/src/components/workModeDialog.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/workModeDialog.ts)
- [client/src/App.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/App.tsx)

## Advanced edit modes currently surfaced

Modes present in the client:

- reshape
- split
- trace
- rotate-scale
- grid-lock
- align variants

These modes are presented through app-level controls and executed by map-canvas-side logic.

## Important implementation note

The advanced editing UI is ahead of some of the underlying geometry logic.

In particular:

- split mode has dedicated UI and interaction flow
- but line-based geometric split still contains fallback logic rather than a full implementation

That means future work should focus on geometry correctness and test coverage before adding more editing breadth.

## Attribute table integration

The attribute table is now a persistent bottom-panel workflow rather than only a modal dialog.

Responsibilities:

- row browsing and exports
- feature selection sync
- property editing
- server query hooks
- bulk update hooks

Primary file:

- [client/src/components/AttributeTablePanel.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/AttributeTablePanel.tsx)

## Styling integration

The same client workspace also supports:

- geometry-aware layer styling
- icon selection for point layers
- polygon pattern selection
- legend behavior that reflects style choices

Primary files:

- [client/src/components/LayerStyleDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/LayerStyleDialog.tsx)
- [client/src/components/PatternPickerDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/PatternPickerDialog.tsx)
- [client/src/components/LayerLegend.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/LayerLegend.tsx)

## Operational direction

The frontend should continue moving toward:

- map-first editing
- less modal interruption
- stronger cursor and guide feedback
- more trustworthy geometry operations
- clearer separation between general GIS mode and domain modes such as utilities
