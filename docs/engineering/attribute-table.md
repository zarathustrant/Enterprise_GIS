# Attribute Table Engineering

## Authoritative query model

The attribute table uses the layer feature-query endpoint as its authoritative source when `onQueryRows` is available. Page, page size, primary sort, and applied filters trigger a server request. Stale responses are ignored when the layer or query changes.

The browser feature collection is only a fallback for contexts without a query service. Server-backed and local rows must not be mixed in the same table state.

## Current operation scope

| Operation | Current scope |
|---|---|
| Table page | Server-filtered current page |
| Primary sort | Entire server result |
| Additional sort columns | Entire server result, up to five fields |
| Quick filter | Entire server result |
| Select all | Current page, filtered result, or entire layer up to 10,000 IDs |
| Invert selection | Current page only |
| Selection statistics | Current page, filtered result, selected records, or entire layer |
| CSV and JSON export | Current page, filtered result, selected records, or entire layer up to 100,000 rows |
| Excel export | Current page or selected loaded rows; async workbook job still required for larger scopes |
| Field calculator | Explicit selected IDs or backend bulk-update scope |

The toolbar exposes an explicit operation scope. Server selection reports truncation when the 10,000-ID browser selection ceiling is reached. Synchronous server exports reject result sets over 100,000 rows instead of returning partial files.

## Editing safeguards

- all schema fields are available in the feature inspector
- coded-value domains render as labeled dropdowns
- boolean fields render as selectors
- range domains supply numeric min/max constraints
- integer parsing requires a complete safe integer
- feature versions are submitted for optimistic conflict detection

## Calculator policy

Arbitrary Python evaluation is prohibited. Calculator expressions use a bounded AST evaluator supporting:

- field names
- scalar constants
- arithmetic and comparisons
- boolean expressions
- conditional expressions
- an explicit function allowlist

Attribute access, subscripting, comprehensions, lambdas, imports, and unapproved function calls are rejected.

## Next implementation order

1. apply explicit scopes to bulk updates and field calculations
2. asynchronous workbook and very-large export jobs
3. virtualized grid and inline dirty-cell editing
4. conflict comparison and transactional batch save
5. related-record summaries, cancellation, and pagination
