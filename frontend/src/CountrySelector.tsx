import { countries, toggleCountry } from './data';
import type { CountryCode } from './data';

export function CountrySymbol({ country, cx, cy }: { country: CountryCode; cx: number; cy: number }) {
  const color = countries.find(item => item.code === country)?.color;
  return <g fill="white" stroke={color} strokeWidth={1.8} aria-hidden="true">
    {country === 'EE' ? <circle cx={cx} cy={cy} r={3.2} /> : country === 'LV' ? <rect x={cx - 3} y={cy - 3} width={6} height={6} /> : <path d={`M${cx},${cy - 4} l4,7 h-8 Z`} />}
  </g>;
}

export default function CountrySelector({ selected, onChange }: {
  selected: CountryCode[];
  onChange: (countries: CountryCode[]) => void;
}) {
  return <fieldset className="country-controls">
    <legend>Compare countries <span>Choose at least two</span></legend>
    <div className="country-buttons">{countries.map(country => <button key={country.code}
      className={`country-button ${selected.includes(country.code) ? 'is-selected' : ''}`}
      aria-label={`${country.name} ${country.code}`}
      aria-pressed={selected.includes(country.code)}
      aria-disabled={selected.includes(country.code) && selected.length === 2}
      onClick={() => onChange(toggleCountry(selected, country.code))}>
      <svg className="country-symbol" viewBox="0 0 16 16" aria-hidden="true"><CountrySymbol country={country.code} cx={8} cy={8} /></svg>{country.name}
      <span className="country-code"> {country.code}</span>
    </button>)}</div>
  </fieldset>;
}
