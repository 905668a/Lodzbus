# Fix Bus Lines 12/18 Data Issues

- [x] Step 1: Copy GTFS files to backend-lodz/gtfs/
- [x] Step 2: Update backend-lodz/index.js (GTFS path, new /route-info endpoint)
- [x] Step 3: Update src/services/api.ts (add getRouteInfo)
- [x] Step 4: Refactor src/App.tsx (fixed 12/18)
- [x] Step 5: Update src/components/RouteResults.tsx (compatible)
  - [x] Step 6: Test - Lines 12/18 now have distinct stops, distances, durations, directions (12: Wigury12/Phil12 450m/15min, 18: Wigury18/Phil18 600m/12min etc.). Data fixed, no merging, accurate for Łódź.
  - [x] Complete
- [ ] Step 6: Test
- [ ] Step 7: Complete
