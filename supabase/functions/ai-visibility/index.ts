// ai-visibility entry point; the logic and its docs live in handler.ts.
import { handler } from './handler.ts';

Deno.serve(handler);
