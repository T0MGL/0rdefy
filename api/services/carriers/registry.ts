/**
 * Carrier provider registration. Importing this module wires every available
 * adapter into the registry. Routes and the push service import from here so
 * the set of providers (and their country availability) is defined in one
 * place.
 */

import { registerCarrier } from './carrier-adapter';
import { puntoAPuntoAdapter } from './punto-a-punto/client';
import { PROVIDER_KEY } from './punto-a-punto/types';

registerCarrier(PROVIDER_KEY, {
  adapter: puntoAPuntoAdapter,
  availableCountries: ['PY'],
});

export { getCarrier, isProviderAvailableInCountry, listProvidersForCountry } from './carrier-adapter';
