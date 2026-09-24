# StudioHeader

The 56px top bar of the Officer Studio and Admin Console.

- Left to right: wordmark with the surface name, primary navigation (**Batches · Map · Register** in the Studio), global search opened with `/`, area or dataset switcher, live status, user initials.
- The active section uses `aria-current="page"` and the `primary-soft` wash. Never add a second navigation row; the 36px scope strip under the bar (area, source classification, revision) is context, not navigation.
- Live status reads "Live" when the server connection is up and "Snapshot 24 Sep, 14:10" when working from saved data.
