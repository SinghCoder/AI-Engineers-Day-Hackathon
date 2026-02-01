const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
};

const mcpOptions = {
  entryPoints: ['src/mcp-stdio.ts'],
  bundle: true,
  outfile: 'out/mcp-stdio.js',
  external: [],
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  banner: { js: '#!/usr/bin/env node' },
};

const traceCliOptions = {
  entryPoints: ['src/cli/write-trace.ts'],
  bundle: true,
  outfile: 'out/write-trace.js',
  external: [],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
};

async function build() {
  if (watch) {
    const ctx = await esbuild.context(extensionOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(extensionOptions);
    await esbuild.build(mcpOptions);
    await esbuild.build(traceCliOptions);
    console.log('Build complete (extension + mcp-stdio + write-trace)');
  }
}

build().catch(() => process.exit(1));
