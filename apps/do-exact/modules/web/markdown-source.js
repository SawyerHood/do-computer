import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { REMARK_PLUGINS, REHYPE_PLUGINS } from '../../../web/src/components/markdown/pipeline.ts';
export { endsInOpenFence, ID_PREFIX } from '../../../web/src/components/markdown/pipeline.ts';
export { tableCsv, tableMarkdown } from '../../../web/src/components/markdown/table-text.ts';
export { resolveLink } from '../../../../packages/protocol/src/library-links.ts';
const parser = unified().use(remarkParse).use(REMARK_PLUGINS).use(remarkRehype, { allowDangerousHtml: true }).use(REHYPE_PLUGINS);
export const parse = source => parser.runSync(parser.parse(source));
