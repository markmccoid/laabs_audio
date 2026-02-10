import { useAuthStore } from "@/auth/auth-store";
import { Text, View } from "react-native";

export default function Index() {
  const a = useAuthStore((state) => state);
  console.log(a.status);
  return (
    <View className="flex-1 justify-center items-center">
      <View className=" p-4 bg-white rounded-full border-hairline border-amber-600">
        <Text>
          User {a.storedUsername} is {a.status} for {a.serverUrl}
        </Text>
      </View>
    </View>
  );
}
