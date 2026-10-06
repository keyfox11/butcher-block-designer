/**
 * The core/ boundary is the architecture's load-bearing constraint: core/ holds
 * the geometry, validation, and cut-list logic that has to be correct, and it
 * stays testable only while it is free of framework entanglement.
 * The dependency arrow points one way: ui -> core, never back.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-ui',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/(ui|app)' },
    },
    {
      name: 'core-must-not-import-frameworks',
      severity: 'error',
      from: { path: '^src/core' },
      to: { dependencyTypes: ['npm'], path: '^(react|react-dom|three|@react-three)' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: ['\.d\.ts$'] }, to: {} },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.app.json' },
    tsPreCompilationDeps: true,
  },
};
