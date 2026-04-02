export interface SpeciesInfo {
  name: string;
  color: string;
  emoji: string;
}

export const SPECIES_LIST: SpeciesInfo[] = [
  { name: 'Whitetail Deer', color: '#8B4513', emoji: '🦌' },
  { name: 'Mule Deer', color: '#A0522D', emoji: '🦌' },
  { name: 'Elk', color: '#CD853F', emoji: '🫎' },
  { name: 'Moose', color: '#654321', emoji: '🫎' },
  { name: 'Wild Turkey', color: '#B22222', emoji: '🦃' },
  { name: 'Black Bear', color: '#2F2F2F', emoji: '🐻' },
  { name: 'Grizzly Bear', color: '#8B6914', emoji: '🐻' },
  { name: 'Wild Boar', color: '#696969', emoji: '🐗' },
  { name: 'Pronghorn', color: '#DAA520', emoji: '🦌' },
  { name: 'Coyote', color: '#C4A882', emoji: '🐺' },
  { name: 'Mountain Lion', color: '#D2B48C', emoji: '🦁' },
  { name: 'Wolf', color: '#808080', emoji: '🐺' },
  { name: 'Bobcat', color: '#BC8F8F', emoji: '🐱' },
  { name: 'Pheasant', color: '#FF6347', emoji: '🐦' },
  { name: 'Duck', color: '#228B22', emoji: '🦆' },
  { name: 'Goose', color: '#556B2F', emoji: '🪿' },
  { name: 'Rabbit', color: '#DEB887', emoji: '🐇' },
  { name: 'Squirrel', color: '#D2691E', emoji: '🐿️' },
  { name: 'Dove', color: '#B0C4DE', emoji: '🕊️' },
  { name: 'Quail', color: '#8FBC8F', emoji: '🐦' },
  { name: 'Unknown', color: '#9E9E9E', emoji: '❓' },
  { name: 'Other', color: '#607D8B', emoji: '🐾' },
];

export function getSpeciesInfo(name: string): SpeciesInfo {
  return SPECIES_LIST.find(s => s.name === name) ?? { name, color: '#9E9E9E', emoji: '🐾' };
}

export function getSpeciesColor(name: string): string {
  return getSpeciesInfo(name).color;
}
