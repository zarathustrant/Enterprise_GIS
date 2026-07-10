# Next Focus

This document describes the most defensible next implementation priorities based on the current codebase.

## Priority 1: Finish geometry-correct advanced editing

The most important gap is not UI breadth. It is trustworthiness of advanced edits.

Focus areas:

- full line-based split implementation
- stronger reshape validation
- geometry-result testing for rotate/scale and related tools
- end-to-end tests that assert actual geometry outcomes, not only UI state

## Priority 2: Complete the advanced attribute workflow loop

The attribute table should become fully operational, not partially wired.

Focus areas:

- query execution wiring
- filter apply behavior
- pagination and sorting consistency
- more reliable map-table synchronization

## Priority 3: Mature utility mode into operational GIS

Utility mode is strategically important because it turns the app from a general GIS into a vertical workflow platform.

Focus areas:

- map-based asset creation
- connectivity and trace logic
- utility-specific symbology and inspection patterns
- future outage or isolation workflows

## Priority 4: Documentation and onboarding

As the product surface grows, onboarding cost rises quickly.

Needed:

- documentation that reflects current code truth
- safe local run instructions
- clearer product direction for contributors

## Priority 5: Performance and packaging

After correctness and workflow completeness improve, the next layer is operational polish.

Focus areas:

- client bundle splitting
- table export lazy loading
- map and editing path optimization
- long-running job visibility and resiliency
