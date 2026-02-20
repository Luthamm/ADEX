<script setup>
const props = defineProps({
  user: {
    type: Object,
    required: true,
  },
});

const AVATAR_COLORS = [
  { bg: '#4A6CF7', text: '#FFFFFF' }, // blue
  { bg: '#2ECC71', text: '#FFFFFF' }, // green
  { bg: '#9B59B6', text: '#FFFFFF' }, // purple
  { bg: '#E67E22', text: '#FFFFFF' }, // orange
  { bg: '#1ABC9C', text: '#FFFFFF' }, // teal
  { bg: '#E84393', text: '#FFFFFF' }, // pink
];

const getInitials = (name, email) => {
  if (!name && !email) return;
  const firstLetter = name?.substring(0, 1) || email?.substring(0, 1) || null;
  return firstLetter;
};

const getAvatarColor = (name, email) => {
  const key = (name || email || '').charAt(0).toLowerCase();
  const index = key ? key.charCodeAt(0) % AVATAR_COLORS.length : 0;
  return AVATAR_COLORS[index];
};
</script>

<template>
  <div
    class="user-container"
    :style="{
      backgroundColor: user.image ? 'transparent' : getAvatarColor(user.name, user.email).bg,
      color: getAvatarColor(user.name, user.email).text,
    }"
  >
    <img
      class="user-bg"
      v-if="user.image"
      :src="user.image.startsWith('http') ? user.image : `data:image/png;base64,${user.image}`"
    />
    <span class="user-bg" v-else>{{ getInitials(user.name, user.email) }}</span>
  </div>
</template>

<style scoped>
.user-container {
  border-radius: 50%;
  font-size: 10px;
  font-weight: bold;

  width: 24px;
  height: 24px;

  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

img {
  border-radius: 50%;
  width: 100%;
  background-color: transparent;
}

span {
  font-weight: bold;
  text-transform: uppercase;
}
</style>
