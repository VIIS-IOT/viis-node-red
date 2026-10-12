import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { TabiotProductionFunction } from '../TabioProductionFunction';

describe('TabiotProductionFunction', () => {
  // Platform function icons are SVG data URIs (~350 chars); varchar(255) made MySQL reject the
  // first insert ("Data too long for column 'icon_url'") and the whole production-function sync stopped.
  it('stores icon_url as text, not varchar(255)', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === TabiotProductionFunction && c.propertyName === 'icon_url',
    );
    expect(column?.options.type).toBe('text');
    expect(column?.options.length).toBeUndefined();
  });
});
