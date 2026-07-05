# Building iOS Apps with Fastlane

```bash

eas build --platform ios --profile production --local
eas submit --platform ios --path build-*.ipa   # when ready to ship
```

# Building and pushing to phone connected to computer for tesing

```bash
npx expo run:ios --device --configuration Release
```
