import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';

const outputDir = 'production/';

// Delete all files in dist (synchronously)
if (fs.existsSync(outputDir)) {
   fs.rmSync(outputDir, { recursive: true, force: true });
}

export default {
	input: 'src/index.js',
	output: {
		dir: outputDir,
		format: 'es',
        plugins: [terser()]
	},
};
