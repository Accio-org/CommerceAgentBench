import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestItems } from '../lib/utils/request-items.js';

describe('Request Items Parser', () => {
  it('parses string body field (key=value)', () => {
    const { body } = parseRequestItems(['query=roadmap']);
    assert.deepStrictEqual(body, { query: 'roadmap' });
  });

  it('parses JSON body field (key:=value)', () => {
    const { body } = parseRequestItems(['archived:=true', 'count:=42']);
    assert.deepStrictEqual(body, { archived: true, count: 42 });
  });

  it('parses query params (key==value)', () => {
    const { queryParams, body } = parseRequestItems(['page_size==100']);
    assert.deepStrictEqual(queryParams, { page_size: '100' });
    assert.strictEqual(body, null);
  });

  it('parses headers (Header:Value)', () => {
    const { headers, body } = parseRequestItems(['Accept:application/json']);
    assert.deepStrictEqual(headers, { Accept: 'application/json' });
    assert.strictEqual(body, null);
  });

  it('parses bracket-nested body field', () => {
    const { body } = parseRequestItems(['parent[page_id]=abc123']);
    assert.deepStrictEqual(body, { parent: { page_id: 'abc123' } });
  });

  it('parses dot-nested body field', () => {
    const { body } = parseRequestItems(['properties.Name.title=hello']);
    assert.deepStrictEqual(body, { properties: { Name: { title: 'hello' } } });
  });

  it('parses array index', () => {
    const { body } = parseRequestItems([
      'children[0][type]=paragraph',
      'children[1][type]=heading_2',
    ]);
    assert.deepStrictEqual(body, {
      children: [{ type: 'paragraph' }, { type: 'heading_2' }],
    });
  });

  it('parses array append (empty brackets)', () => {
    const { body } = parseRequestItems([
      'rich_text[][text][content]=First',
      'rich_text[][text][content]=Second',
    ]);
    assert.strictEqual(body.rich_text[0].text.content, 'First');
    assert.strictEqual(body.rich_text[1].text.content, 'Second');
  });

  it('parses mixed inline items', () => {
    const { body, queryParams, headers } = parseRequestItems([
      'query=roadmap',
      'page_size:=10',
      'start_cursor==abc',
      'X-Custom:test',
    ]);
    assert.deepStrictEqual(body, { query: 'roadmap', page_size: 10 });
    assert.deepStrictEqual(queryParams, { start_cursor: 'abc' });
    assert.deepStrictEqual(headers, { 'X-Custom': 'test' });
  });

  it('parses deeply nested bracket path', () => {
    const { body } = parseRequestItems([
      'children[0][paragraph][rich_text][0][text][content]=Hello',
    ]);
    assert.strictEqual(body.children[0].paragraph.rich_text[0].text.content, 'Hello');
  });

  it('returns null body when no body items', () => {
    const { body } = parseRequestItems(['page_size==10']);
    assert.strictEqual(body, null);
  });

  it('handles JSON array value', () => {
    const { body } = parseRequestItems(['filter:={"property":"object","value":"page"}']);
    assert.deepStrictEqual(body.filter, { property: 'object', value: 'page' });
  });

  it('handles empty items', () => {
    const { body, queryParams, headers } = parseRequestItems([]);
    assert.strictEqual(body, null);
    assert.deepStrictEqual(queryParams, {});
    assert.deepStrictEqual(headers, {});
  });
});
