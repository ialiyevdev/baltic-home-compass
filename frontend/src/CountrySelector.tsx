import { countries, toggleCountry } from './data';
import type { CountryCode } from './data';

export default function CountrySelector({ selected, onChange }: {
  selected: CountryCode[];
  onChange: (countries: CountryCode[]) => void;
}) {
  return <fieldset className="country-controls">
    <legend>Compare countries <span>Choose at least two</span></legend>
    <div className="country-buttons">{countries.map(country => <button key={country.code}
      className={`country-button ${selected.includes(country.code) ? 'is-selected' : ''}`}
      aria-label={`${country.name} (${country.code})`}
      aria-pressed={selected.includes(country.code)}
      aria-disabled={selected.includes(country.code) && selected.length === 2}
      onClick={() => onChange(toggleCountry(selected, country.code))}>
      <span className="country-dot" style={{ backgroundColor: country.color }} />{country.name}
      <span className="country-code">{country.code}</span>
    </button>)}</div>
  </fieldset>;
}
