import { register } from 'node:module';

// Register before dynamically importing the tested TypeScript module graph.
register('./typescript-loader.js', import.meta.url);