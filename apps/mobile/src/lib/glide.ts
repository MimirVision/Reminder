import { LayoutAnimation } from 'react-native';

/** Call just before a state change that adds, removes or moves rows: the rows slide and fade instead of jumping. */
export function glide(): void {
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
