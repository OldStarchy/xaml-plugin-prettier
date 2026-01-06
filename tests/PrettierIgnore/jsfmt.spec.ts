import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Call run_spec - it will register tests synchronously via the test() function
await (global as any).run_spec(__dirname);
