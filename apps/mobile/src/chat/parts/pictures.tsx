import { Image } from "expo-image"
import { memo, useState } from "react"
import {
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { GlassButton, Text } from "@/ui"

/** A picture to show: where it is, and what its request must carry. */
export type Picture = { uri: string; headers?: Record<string, string>; name?: string }

/**
 * Pictures shown large, over everything: one to a page, swiped between, and on iOS pinched to
 * look closer (each page is a scroll view that zooms, which costs nothing).
 */
export function PictureViewer({
  pictures,
  at,
  onClose,
}: {
  pictures: readonly Picture[]
  /** Which is shown first; undefined while the viewer is shut. */
  at: number | undefined
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [page, setPage] = useState(0)
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))
  const shown = at === undefined ? 0 : page
  return (
    <Modal
      visible={at !== undefined}
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      statusBarTranslucent
      onShow={() => setPage(at ?? 0)}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "#000" }} accessibilityViewIsModal>
        {at === undefined ? null : (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: at * width, y: 0 }}
            onMomentumScrollEnd={onScroll}
            scrollEventThrottle={64}
            onScroll={Platform.OS === "web" ? onScroll : undefined}
          >
            {pictures.map((picture, index) => (
              <ScrollView
                key={index}
                style={{ width, height }}
                contentContainerStyle={{ width, height }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                bouncesZoom
                centerContent
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={picture.name ?? "Attached"}
                  accessibilityHint="Closes the picture"
                  onPress={onClose}
                  style={{ width, height }}
                >
                  <Image
                    source={{
                      uri: picture.uri,
                      ...(picture.headers && { headers: picture.headers }),
                    }}
                    contentFit="contain"
                    style={{ width, height }}
                  />
                </Pressable>
              </ScrollView>
            ))}
          </ScrollView>
        )}
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 16,
            right: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <GlassButton icon="close" label="Close" onPress={onClose} />
          {pictures.length > 1 ? (
            <Text variant="subhead" weight="600" color="#fff">
              {shown + 1} of {pictures.length}
            </Text>
          ) : null}
          <View style={{ width: 44 }} />
        </View>
      </View>
    </Modal>
  )
}

/**
 * The pictures attached to a sent message, small, at the side the message is on. A tap opens
 * them large.
 */
export const SentPictures = memo(function SentPictures({
  pictures,
}: {
  pictures: readonly Picture[]
}) {
  const [at, setAt] = useState<number>()
  if (pictures.length === 0) return null
  const size = pictures.length === 1 ? 220 : 132
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
        {pictures.map((picture, index) => (
          <Pressable
            key={index}
            accessibilityRole="imagebutton"
            accessibilityLabel={picture.name ?? "Attached"}
            accessibilityHint="Opens the picture large"
            onPress={() => setAt(index)}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <Image
              source={{ uri: picture.uri }}
              contentFit="cover"
              transition={120}
              style={{ width: size, height: size, borderRadius: 16 }}
            />
          </Pressable>
        ))}
      </View>
      <PictureViewer pictures={pictures} at={at} onClose={() => setAt(undefined)} />
    </>
  )
})
