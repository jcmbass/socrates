/**
 * The tutor's circular portrait (DESIGN.md §5): calm, never a mascot.
 * `variant="contemplating"` is the reflection/waiting pose, reserved for
 * "thinking" states (paired with ThinkingDots — see study/[subjectId].tsx);
 * the default `variant="avatar"` (face, Σ on the collar) sits next to every
 * tutor reply (TutorMessage.tsx). Decorative — the surrounding message/
 * status text already carries the accessible label, so this is hidden from
 * screen readers to avoid a redundant announcement.
 */
import { Image } from "react-native";

import avatarSource from "../assets/images/socrates-avatar.jpg";
import contemplatingSource from "../assets/images/socrates-contemplating.jpg";

const DEFAULT_SIZE = 28;

const SOURCES = {
  avatar: avatarSource,
  contemplating: contemplatingSource,
} as const;

export function TutorAvatar(props: { variant?: "avatar" | "contemplating"; size?: number }) {
  const size = props.size ?? DEFAULT_SIZE;
  const source = SOURCES[props.variant ?? "avatar"];

  return (
    <Image
      source={source}
      alt=""
      accessible={false}
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
      }}
    />
  );
}
